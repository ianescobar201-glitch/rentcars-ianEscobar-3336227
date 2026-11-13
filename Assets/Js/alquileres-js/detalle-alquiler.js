(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const API_URL = '../../controllers/alquileres/detalle.php';
  const DEFAULT_CONDITIONS = '';
  const MAX_PDF_BYTES = 1024 * 1024;

  let rentals = [];
  let contracts = [];
  let csrfToken = '';
  let currentContract = null;
  let currentRental = null;
  let currentVehicle = null;
  let currentCustomer = {};
  let pendingPdfFile = null;
  let pendingPdfUrl = '';

  // ----------------------------------------------------------
  // API y funciones generales
  // ----------------------------------------------------------

  async function requestApi(method, params = {}) {
    const options = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    let url = API_URL;

    if (method === 'GET') {
      const query = new URLSearchParams(params);
      url += `?${query.toString()}`;
    } else if (params instanceof FormData) {
      options.body = params;
    } else {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      options.body = new URLSearchParams(params);
    }

    const response = await fetch(url, options);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('El servidor devolvió una respuesta inválida.');
    }

    if (!response.ok || !data.ok) {
      throw new Error(data.mensaje || 'No fue posible completar la solicitud.');
    }

    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clearPendingPdf() {
    if (pendingPdfUrl) {
      URL.revokeObjectURL(pendingPdfUrl);
    }
    pendingPdfFile = null;
    pendingPdfUrl = '';
  }

  function showMessage(message, type = 'info') {
    const element = $('pageMessage');
    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.classList.remove('d-none');
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideMessage() {
    $('pageMessage').classList.add('d-none');
  }

  function showRentalMessage(message, type = 'info') {
    const element = $('rentalHistoryMessage');
    element.className = `alert alert-${type} mx-3 mx-lg-4`;
    element.textContent = message;
    element.classList.remove('d-none');
  }

  function hideRentalMessage() {
    $('rentalHistoryMessage').classList.add('d-none');
  }

  function showContractHistoryMessage(message, type = 'info') {
    const element = $('contractHistoryMessage');
    element.className = `alert alert-${type} mx-3 mx-lg-4`;
    element.textContent = message;
    element.classList.remove('d-none');
  }

  function hideContractHistoryMessage() {
    $('contractHistoryMessage').classList.add('d-none');
  }

  function formatDate(value) {
    if (!value) return '—';
    const text = String(value).slice(0, 10);
    const parts = text.split('-');
    if (parts.length !== 3 || parts.some((part) => !part)) return String(value);
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const text = String(value);
    const date = formatDate(text);
    const match = text.match(/[T ](\d{2}):(\d{2})/);
    if (!match) return date;

    let hour = Number(match[1]);
    const minutes = match[2];
    const period = hour >= 12 ? 'p. m.' : 'a. m.';
    hour = hour % 12 || 12;
    return `${date}, ${hour}:${minutes} ${period}`;
  }

  function toLocalDateTime(value) {
    if (!value) return '';
    const text = String(value);
    const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    if (match) return `${match[1]}T${match[2]}`;
    const date = dateOnly(text);
    return date ? `${date}T09:00` : '';
  }

  function currentLocalDateTime() {
    const now = new Date();
    const pad = (number) => String(number).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function dateOnly(value) {
    const text = String(value || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function money(value) {
    if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value))) {
      return 'No disponible';
    }
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0
    }).format(Number(value));
  }

  function setText(id, value, fallback = '—') {
    const element = $(id);
    if (element) element.textContent = value === undefined || value === null || value === '' ? fallback : value;
  }

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  // ----------------------------------------------------------
  // Datos recibidos desde el endpoint
  // ----------------------------------------------------------

  function getRentals() { return rentals; }
  function getContracts() { return contracts; }

  function getVehicleForRental(rental) {
    return rental?.vehiculo || null;
  }

  function getVehicleCategory(id) {
    const vehicle = rentals
      .map((rental) => rental.vehiculo)
      .find((item) => String(item?.id_categoria) === String(id));
    return vehicle?.nombre_categoria || 'Sin categoría';
  }

  function getVehicleName(vehicle) {
    if (!vehicle) return 'Vehículo no disponible';
    const name = `${vehicle.marca || ''} ${vehicle.modelo || ''}`.trim();
    return name || 'Vehículo sin nombre';
  }

  function getCustomerForRental(rental) {
    return rental?.cliente || {};
  }

  function getCustomerForContract(contract) {
    if (!contract) return {};

    const rental = getRentals().find(
      (item) => String(item.id_alquiler) === String(contract.id_alquiler)
    );
    return contract.cliente || getCustomerForRental(rental);
  }

  function customerDisplayName(customer) {
    const name = `${customer?.nombre || ''} ${customer?.apellido || ''}`.trim();
    return name || 'Cliente no vinculado';
  }

  function customerFilterKey(customer) {
    const email = String(customer?.correo || '').trim().toLowerCase();
    if (email) return `email:${email}`;
    const name = customerDisplayName(customer);
    if (name !== 'Cliente no vinculado') return `name:${name.toLowerCase()}`;
    return 'unknown';
  }

  // ----------------------------------------------------------
  // Estado del contrato, números y URL
  // ----------------------------------------------------------

  function statusClass(status) {
    const value = normalize(status);
    if (value.includes('cancel')) return 'status-cancelled';
    if (value.includes('finaliz')) return 'status-finished';
    if (value.includes('completado')) return 'status-finished';
    if (value.includes('activo')) return 'status-active';
    return 'status-pending';
  }

  function statusBadge(status) {
    return `<span class="table-status ${statusClass(status)}">${escapeHtml(status || 'Pendiente de generación')}</span>`;
  }

  function nextContractNumber() {
    const year = new Date().getFullYear();
    const prefix = `RC-${year}-`;
    const numbers = getContracts()
      .filter((item) => String(item.numero_contrato || '').startsWith(prefix))
      .map((item) => Number(String(item.numero_contrato).slice(prefix.length)) || 0);
    return `${prefix}${String(Math.max(0, ...numbers) + 1).padStart(4, '0')}`;
  }

  function updateContractUrl(contract) {
    if (!contract || !contract.id_contrato) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('contrato', contract.numero_contrato);
      url.searchParams.delete('alquiler');
      url.searchParams.delete('id_alquiler');
      url.searchParams.delete('id_contrato');
      window.history.replaceState({}, '', url);
    } catch (error) {
      // La URL no es necesaria para que el formulario funcione.
    }
  }

  // ----------------------------------------------------------
  // Panel de datos del cliente (sin inventar datos ausentes)
  // ----------------------------------------------------------

  function renderCustomerPanel(customer = {}) {
    const hasCustomer = Boolean(customer.nombre || customer.apellido || customer.correo);

    setText('clientFirstName', customer.nombre, 'Cliente no vinculado');
    setText('clientLastName', customer.apellido, '—');
    setText('clientEmail', customer.correo, 'No disponible');
    setText('clientRole', customer.rol, 'Cliente');
    setText('clientState', customer.estado, 'No disponible');

    $('customerInformationNote').textContent = hasCustomer
      ? 'Los datos mostrados provienen de la cuenta vinculada al alquiler en la base de datos.'
      : 'No se encontraron datos de usuario asociados a este alquiler.';
  }

  // ----------------------------------------------------------
  // Campos editables del contrato
  // ----------------------------------------------------------

  function enableContractFields(enabled) {
    $('contractFields').disabled = !enabled;
    $('contractFormNotice').classList.toggle('d-none', enabled);
    $('saveContractBtn').disabled = !enabled;
    $('downloadContractBtn').disabled = !enabled;
  }

  function renderContractDetails() {
    const contract = currentContract;

    if (!contract) {
      $('contractContent').classList.add('d-none');
      $('contractEmptyState').classList.remove('d-none');
      $('contractStatus').textContent = 'Sin contrato seleccionado';
      $('contractStatus').className = 'contract-status status-pending';
      enableContractFields(false);
      renderCustomerPanel(currentRental ? getCustomerForRental(currentRental) : {});
      return;
    }

    $('contractContent').classList.remove('d-none');
    $('contractEmptyState').classList.add('d-none');
    enableContractFields(true);

    currentRental = getRentals().find(
      (item) => String(item.id_alquiler) === String(contract.id_alquiler)
    ) || currentRental;

    currentVehicle = currentRental
      ? getVehicleForRental(currentRental)
      : contract.vehiculo || null;

    currentCustomer = getCustomerForContract(contract);
    renderCustomerPanel(currentCustomer);

    setText('summaryContractNumber', contract.numero_contrato, 'Por asignar');
    setText('summaryCustomerName', customerDisplayName(currentCustomer), 'Cliente no vinculado');
    setText('summaryCustomerEmail', currentCustomer.correo, 'Correo no disponible');
    setText('summaryTotal', money(contract.valor_total));
    setText('summaryGenerationDate', formatDateTime(contract.fecha_generacion));
    setText('summaryStartDate', formatDateTime(contract.fecha_inicio));
    setText('summaryEndDate', formatDateTime(contract.fecha_fin));

    const status = contract.estado || 'Pendiente de generación';
    $('contractStatus').textContent = status;
    $('contractStatus').className = `contract-status ${statusClass(status)}`;

    $('numeroContrato').value = contract.numero_contrato || '';
    $('fechaGeneracion').value = toLocalDateTime(contract.fecha_generacion) || currentLocalDateTime();
    $('fechaInicio').value = toLocalDateTime(contract.fecha_inicio);
    $('fechaFin').value = toLocalDateTime(contract.fecha_fin);
    $('tipoTarifa').value = contract.tipo_tarifa || '';
    $('valorTarifa').value = contract.valor_tarifa ?? '';
    $('kilometrajeInicial').value = contract.kilometraje_inicial ?? '';
    $('kilometrajeFinal').value = contract.kilometraje_final ?? '';
    $('valorTotal').value = contract.valor_total ?? '';
    $('estadoContrato').value = contract.estado || 'Pendiente de generación';
    $('condiciones').value = contract.condiciones || DEFAULT_CONDITIONS;
    $('observaciones').value = contract.observaciones || '';

    clearPendingPdf();
    const storedPdfUrl = contract.archivo_contrato_url || '';
    const storedPdfName = contract.archivo_contrato || '';

    setText('archivoContratoNombre', storedPdfName ? 'PDF adjunto al contrato.' : 'No se ha adjuntado un archivo PDF.');

    const link = $('archivoContratoLink');
    if (storedPdfUrl) {
      link.href = storedPdfUrl;
      link.download = `Contrato-${contract.numero_contrato}.pdf`;
      link.textContent = 'Descargar PDF adjunto';
      link.classList.remove('d-none');
    } else {
      link.href = '#';
      link.removeAttribute('download');
      link.textContent = 'Preparar PDF para guardar';
      link.classList.remove('d-none');
    }

    $('archivoContrato').value = '';
  }

  function findContractFromUrl() {
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (error) {
      return null;
    }

    const contractReference = params.get('contrato') || params.get('id_contrato');
    const rentalReference = params.get('alquiler') || params.get('id_alquiler');
    const contracts = getContracts();

    if (contractReference) {
      const found = contracts.find((contract) =>
        String(contract.numero_contrato) === String(contractReference) ||
        String(contract.id_contrato) === String(contractReference)
      );
      if (found) return found;
    }

    if (rentalReference) {
      const found = contracts.find(
        (contract) => String(contract.id_alquiler) === String(rentalReference)
      );
      if (found) return found;

      currentRental = getRentals().find(
        (rental) => String(rental.id_alquiler) === String(rentalReference)
      ) || null;
    }

    return null;
  }

  function selectContract(contract, scroll = false) {
    if (!contract) return;
    currentContract = contract;
    currentRental = getRentals().find(
      (item) => String(item.id_alquiler) === String(contract.id_alquiler)
    ) || null;
    currentVehicle = currentRental ? getVehicleForRental(currentRental) : null;
    currentCustomer = getCustomerForContract(contract);
    updateContractUrl(contract);
    renderContractDetails();
    hideMessage();

    if (scroll) {
      $('contractSummarySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ----------------------------------------------------------
  // Crear un borrador de contrato a partir de un alquiler
  // ----------------------------------------------------------

  function createContractForRental(rentalId) {
    hideMessage();
    hideRentalMessage();

    const rental = getRentals().find(
      (item) => String(item.id_alquiler) === String(rentalId)
    );

    if (!rental) {
      showRentalMessage('No se encontró el alquiler seleccionado.', 'warning');
      return;
    }

    const existing = getContracts().find(
      (contract) => String(contract.id_alquiler) === String(rental.id_alquiler)
    );

    if (existing) {
      selectContract(existing, true);
      showMessage('Este alquiler ya tiene un contrato. Puedes revisar o completar sus campos.', 'info');
      return;
    }

    if (normalize(rental.estado).includes('cancel')) {
      showRentalMessage('No se puede generar un contrato para un alquiler cancelado.', 'warning');
      return;
    }

    const customer = getCustomerForRental(rental);
    const vehicle = getVehicleForRental(rental) || {};
    const contractNumber = nextContractNumber();

    const contract = {
      id_contrato: null,
      id_alquiler: rental.id_alquiler,
      id_vehiculo: rental.id_vehiculo,
      id_usuario: customer.id_usuario || rental.id_usuario || null,
      numero_contrato: contractNumber,
      fecha_generacion: currentLocalDateTime(),
      fecha_inicio: toLocalDateTime(rental.fecha_entrega),
      fecha_fin: toLocalDateTime(rental.fecha_devolucion_programada || rental.fecha_devolucion),
      tipo_tarifa: rental.tipo_tarifa || '',
      valor_tarifa: rental.valor_tarifa ?? '',
      kilometraje_inicial: rental.kilometraje_inicial ?? '',
      kilometraje_final: '',
      valor_total: rental.valor_total ?? '',
      condiciones: '',
      observaciones: '',
      archivo_contrato: null,
      archivo_contrato_url: '',
      estado: 'Pendiente de generación',
      cliente: {
        nombre: customer.nombre || '',
        apellido: customer.apellido || '',
        correo: customer.correo || '',
        rol: customer.rol || 'Cliente',
        estado: customer.estado || ''
      },
      vehiculo: {
        marca: vehicle.marca || '',
        modelo: vehicle.modelo || '',
        placa: vehicle.placa || '',
        anio: vehicle.anio || vehicle.año || '',
        color: vehicle.color || '',
        nombre_categoria: getVehicleCategory(vehicle.id_categoria)
      }
    };

    currentContract = contract;
    currentRental = rental;
    currentVehicle = vehicle;
    currentCustomer = customer;

    selectContract(contract, true);
    renderRentalHistory();
    renderContractHistory();

    showMessage(
      customer.nombre || customer.apellido || customer.correo
        ? `Se preparó el borrador ${contractNumber}. Completa los campos y guárdalo para registrarlo en la base de datos.`
        : `Se preparó el borrador ${contractNumber}. El cliente se cargará desde la relación guardada en la base de datos.`,
      'info'
    );
  }

  // ----------------------------------------------------------
  // Guardar los campos del contrato
  // ----------------------------------------------------------

  function readContractForm() {
    return {
      numero_contrato: $('numeroContrato').value.trim(),
      fecha_generacion: $('fechaGeneracion').value,
      fecha_inicio: $('fechaInicio').value,
      fecha_fin: $('fechaFin').value,
      tipo_tarifa: $('tipoTarifa').value.trim(),
      valor_tarifa: $('valorTarifa').value === '' ? '' : Number($('valorTarifa').value),
      kilometraje_inicial: $('kilometrajeInicial').value === '' ? null : Number($('kilometrajeInicial').value),
      kilometraje_final: $('kilometrajeFinal').value === '' ? null : Number($('kilometrajeFinal').value),
      valor_total: $('valorTotal').value === '' ? '' : Number($('valorTotal').value),
      condiciones: $('condiciones').value.trim(),
      observaciones: $('observaciones').value.trim(),
      estado: $('estadoContrato').value,
      archivo_contrato: currentContract.archivo_contrato || null
    };
  }

  function validateContractForm(data) {
    const requiredFields = [
      ['numero_contrato', 'Escribe el número de contrato.'],
      ['fecha_generacion', 'Completa la fecha de generación.'],
      ['fecha_inicio', 'Completa la fecha de inicio.'],
      ['fecha_fin', 'Completa la fecha de fin.'],
      ['tipo_tarifa', 'Completa el tipo de tarifa.'],
      ['valor_tarifa', 'Completa el valor de la tarifa.'],
      ['valor_total', 'Completa el valor total.'],
      ['condiciones', 'Completa las condiciones del contrato.']
    ];

    for (const [field, message] of requiredFields) {
      if (data[field] === '' || data[field] === null || data[field] === undefined) {
        showMessage(message, 'warning');
        const elementMap = {
          numero_contrato: 'numeroContrato',
          fecha_generacion: 'fechaGeneracion',
          fecha_inicio: 'fechaInicio',
          fecha_fin: 'fechaFin',
          tipo_tarifa: 'tipoTarifa',
          valor_tarifa: 'valorTarifa',
          valor_total: 'valorTotal',
          condiciones: 'condiciones'
        };
        $(elementMap[field]).focus();
        return false;
      }
    }

    const start = new Date(data.fecha_inicio).getTime();
    const end = new Date(data.fecha_fin).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      showMessage('La fecha de fin debe ser posterior a la fecha de inicio.', 'warning');
      $('fechaFin').focus();
      return false;
    }

    if (!Number.isFinite(Number(data.valor_tarifa)) || Number(data.valor_tarifa) < 0) {
      showMessage('El valor de tarifa debe ser un número igual o mayor que cero.', 'warning');
      $('valorTarifa').focus();
      return false;
    }

    if (!Number.isFinite(Number(data.valor_total)) || Number(data.valor_total) < 0) {
      showMessage('El valor total debe ser un número igual o mayor que cero.', 'warning');
      $('valorTotal').focus();
      return false;
    }

    for (const field of ['kilometraje_inicial', 'kilometraje_final']) {
      if (data[field] !== null && (!Number.isInteger(Number(data[field])) || Number(data[field]) < 0)) {
        showMessage('Los kilometrajes deben ser números enteros iguales o mayores que cero.', 'warning');
        $(field === 'kilometraje_inicial' ? 'kilometrajeInicial' : 'kilometrajeFinal').focus();
        return false;
      }
    }

    if (
      data.kilometraje_inicial !== null &&
      data.kilometraje_final !== null &&
      Number(data.kilometraje_final) < Number(data.kilometraje_inicial)
    ) {
      showMessage('El kilometraje final no puede ser menor que el inicial.', 'warning');
      $('kilometrajeFinal').focus();
      return false;
    }

    const duplicateNumber = getContracts().some((contract) =>
      String(contract.numero_contrato).toLowerCase() === data.numero_contrato.toLowerCase() &&
      String(contract.id_contrato) !== String(currentContract.id_contrato)
    );

    if (duplicateNumber) {
      showMessage('Ya existe otro contrato con ese número. Utiliza un número diferente.', 'warning');
      $('numeroContrato').focus();
      return false;
    }

    return true;
  }

  async function saveContract(showSuccess = true) {
    if (!currentContract) {
      showMessage('Primero selecciona un alquiler para crear el contrato.', 'warning');
      return false;
    }

    const data = readContractForm();
    if (!validateContractForm(data)) return false;

    const formData = new FormData();
    formData.append('action', 'save_contract');
    formData.append('csrf_token', csrfToken);
    formData.append('id_alquiler', String(currentContract.id_alquiler));
    Object.entries(data).forEach(([key, value]) => {
      if (key !== 'archivo_contrato') {
        formData.append(key, value === null ? '' : String(value));
      }
    });
    if (pendingPdfFile) {
      formData.append('archivo_contrato', pendingPdfFile, pendingPdfFile.name);
    }

    $('saveContractBtn').disabled = true;
    try {
      const response = await requestApi('POST', formData);
      const saved = response.contrato;
      contracts = contracts.filter(
        (contract) => String(contract.id_alquiler) !== String(saved.id_alquiler)
      );
      contracts.push(saved);
      currentContract = saved;
      currentRental = getRentals().find(
        (rental) => String(rental.id_alquiler) === String(saved.id_alquiler)
      ) || currentRental;
      currentVehicle = getVehicleForRental(currentRental);
      currentCustomer = getCustomerForContract(saved);

      updateContractUrl(saved);
      renderContractDetails();
      populateContractCustomerFilter();
      renderContractHistory();
      renderRentalHistory();

      if (showSuccess) {
        showMessage(response.mensaje, 'success');
      }
      return true;
    } catch (error) {
      showMessage(error.message, 'danger');
      return false;
    } finally {
      $('saveContractBtn').disabled = !currentContract;
    }
  }

  // ----------------------------------------------------------
  // Archivo PDF adjunto
  // ----------------------------------------------------------

  function handlePdfSelected(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      event.target.value = '';
      showMessage('Selecciona un archivo PDF válido.', 'warning');
      return;
    }

    if (file.size > MAX_PDF_BYTES) {
      event.target.value = '';
      showMessage('El PDF debe pesar 1 MB o menos.', 'warning');
      return;
    }

    clearPendingPdf();
    pendingPdfFile = file;
    pendingPdfUrl = URL.createObjectURL(file);
    setText('archivoContratoNombre', file.name);
    $('archivoContratoLink').textContent = 'Descargar PDF seleccionado';
    $('archivoContratoLink').href = pendingPdfUrl;
    $('archivoContratoLink').download = file.name;
    $('archivoContratoLink').classList.remove('d-none');
    showMessage('PDF seleccionado. Pulsa «Guardar datos del contrato» para subirlo al servidor.', 'info');
  }

  // ----------------------------------------------------------
  // PDF imprimible cuando no existe un archivo adjunto
  // ----------------------------------------------------------

  function buildPrintableHtml(contract) {
    const customer = getCustomerForContract(contract);
    const vehicle = getVehicleForRental(currentRental) || contract.vehiculo || {};

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(contract.numero_contrato)}</title>
<style>
*{box-sizing:border-box}body{padding:32px;color:#2f353a;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #34383c;padding-bottom:15px}.brand{font-size:25px;font-weight:800;letter-spacing:2px}h1{font-size:19px;margin:0 0 5px}h2{margin:22px 0 7px;padding:8px;background:#eef0f2;font-size:13px}.muted{color:#666;font-size:11px}table{width:100%;border-collapse:collapse}td{padding:7px;border-bottom:1px solid #ddd;vertical-align:top}td:first-child{width:32%;font-weight:bold}.text-block{padding:11px;border:1px solid #ddd;min-height:35px;white-space:pre-wrap}.signatures{display:flex;gap:45px;margin-top:60px}.signature{width:50%;padding-top:8px;border-top:1px solid #333}@media print{body{padding:0}}
</style>
</head>
<body>
  <div class="top"><div><div class="brand">RENTCARS</div><div>Contrato de alquiler de vehículo</div></div><div><h1>${escapeHtml(contract.numero_contrato)}</h1><div class="muted">Generado: ${escapeHtml(formatDateTime(contract.fecha_generacion))}</div></div></div>
  <h2>Datos del cliente</h2><table>
    <tr><td>Nombre</td><td>${escapeHtml(customer.nombre || 'Cliente no vinculado')}</td></tr>
    <tr><td>Apellido</td><td>${escapeHtml(customer.apellido || '—')}</td></tr>
    <tr><td>Correo</td><td>${escapeHtml(customer.correo || 'No disponible')}</td></tr>
  </table>
  <h2>Datos del vehículo</h2><table>
    <tr><td>Vehículo</td><td>${escapeHtml(getVehicleName(vehicle))}</td></tr>
    <tr><td>Placa</td><td>${escapeHtml(vehicle.placa || 'No registrada')}</td></tr>
    <tr><td>Categoría</td><td>${escapeHtml(vehicle.nombre_categoria || getVehicleCategory(vehicle.id_categoria))}</td></tr>
  </table>
  <h2>Información del contrato</h2><table>
    <tr><td>Fecha de generación</td><td>${escapeHtml(formatDateTime(contract.fecha_generacion))}</td></tr>
    <tr><td>Fecha de inicio</td><td>${escapeHtml(formatDateTime(contract.fecha_inicio))}</td></tr>
    <tr><td>Fecha de fin</td><td>${escapeHtml(formatDateTime(contract.fecha_fin))}</td></tr>
    <tr><td>Tipo de tarifa</td><td>${escapeHtml(contract.tipo_tarifa || 'No especificada')}</td></tr>
    <tr><td>Valor de tarifa</td><td>${escapeHtml(money(contract.valor_tarifa))}</td></tr>
    <tr><td>Kilometraje inicial</td><td>${escapeHtml(contract.kilometraje_inicial ?? 'No registrado')}</td></tr>
    <tr><td>Kilometraje final</td><td>${escapeHtml(contract.kilometraje_final ?? 'Pendiente')}</td></tr>
    <tr><td>Valor total</td><td><strong>${escapeHtml(money(contract.valor_total))}</strong></td></tr>
    <tr><td>Estado</td><td>${escapeHtml(contract.estado || 'Pendiente de generación')}</td></tr>
  </table>
  <h2>Condiciones</h2><div class="text-block">${escapeHtml(contract.condiciones || 'Sin condiciones registradas.')}</div>
  <h2>Observaciones</h2><div class="text-block">${escapeHtml(contract.observaciones || 'Sin observaciones.')}</div>
  <div class="signatures"><div class="signature">Firma del cliente</div><div class="signature">Firma del representante de Rentcars</div></div>
</body></html>`;
  }

  async function downloadPrintableContract() {
    const printWindow = currentContract?.archivo_contrato_url || pendingPdfFile
      ? null
      : window.open('', '_blank');

    if (!currentContract?.archivo_contrato_url && !pendingPdfFile && !printWindow) {
      showMessage('El navegador bloqueó la ventana del contrato. Permite las ventanas emergentes e inténtalo de nuevo.', 'warning');
      return;
    }

    if (!await saveContract(false)) {
      if (printWindow) printWindow.close();
      return;
    }

    if (currentContract.archivo_contrato_url) {
      if (printWindow) printWindow.close();
      const link = document.createElement('a');
      link.href = currentContract.archivo_contrato_url;
      link.download = `Contrato-${currentContract.numero_contrato}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      showMessage('Se inició la descarga del PDF adjunto.', 'success');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildPrintableHtml(currentContract));
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 350);

    showMessage('Se preparó el contrato. En la ventana de impresión selecciona «Guardar como PDF».', 'success');
  }

  function handlePdfLinkClick(event) {
    if (!currentContract) return;

    if (currentContract.archivo_contrato_url || pendingPdfFile) {
      return;
    }

    event.preventDefault();
    void downloadPrintableContract();
  }

  // ----------------------------------------------------------
  // Historial de alquileres
  // ----------------------------------------------------------

  function renderRentalHistory() {
    const tbody = $('rentalHistoryBody');
    const search = $('rentalSearch').value.trim().toLowerCase();
    const statusFilter = $('rentalStatusFilter').value;
    const rentals = [...getRentals()].sort((a, b) =>
      new Date(b.fecha_registro || b.fecha_entrega || 0) -
      new Date(a.fecha_registro || a.fecha_entrega || 0)
    );
    const contracts = getContracts();

    const filtered = rentals.filter((rental) => {
      const customer = getCustomerForRental(rental);
      const vehicle = getVehicleForRental(rental);
      const searchable = [
        customer.nombre, customer.apellido, customer.correo,
        getVehicleName(vehicle), vehicle?.placa
      ].join(' ').toLowerCase();
      if (search && !searchable.includes(search)) return false;

      const status = normalize(rental.estado);
      if (statusFilter === 'activo' && (!status.includes('activo') || status.includes('inactivo'))) {
        return false;
      }
      if (statusFilter === 'cancelado' && !status.includes('cancel')) {
        return false;
      }
      if (statusFilter === 'completado' && !status.includes('completado')) {
        return false;
      }
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="history-empty">${rentals.length ? 'No hay alquileres que coincidan con los filtros.' : 'Todavía no hay alquileres registrados.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((rental) => {
      const customer = getCustomerForRental(rental);
      const vehicle = getVehicleForRental(rental);
      const existingContract = contracts.find(
        (contract) => String(contract.id_alquiler) === String(rental.id_alquiler)
      );

      const isCancelled = normalize(rental.estado).includes('cancel');
      const button = existingContract
        ? `<button type="button" class="btn-table btn-table-secondary" data-action="view-contract" data-number="${escapeHtml(existingContract.numero_contrato)}">Ver contrato</button>`
        : isCancelled
          ? '<button type="button" class="btn-table btn-table-secondary" disabled title="Los alquileres cancelados no admiten contratos">No disponible</button>'
        : `<button type="button" class="btn-table btn-table-primary" data-action="create-contract" data-rental="${escapeHtml(rental.id_alquiler)}">Generar contrato</button>`;

      return `
        <tr>
          <td>${escapeHtml(customer.nombre || 'Cliente no vinculado')}</td>
          <td>${escapeHtml(customer.apellido || '—')}</td>
          <td class="client-email-cell">${escapeHtml(customer.correo || 'No disponible')}</td>
          <td>${escapeHtml(getVehicleName(vehicle))}${vehicle?.placa ? `<div class="text-muted small">Placa: ${escapeHtml(vehicle.placa)}</div>` : ''}</td>
          <td>${escapeHtml(formatDateTime(rental.fecha_entrega))}</td>
          <td>${escapeHtml(formatDateTime(rental.fecha_devolucion_programada || rental.fecha_devolucion))}</td>
          <td>${escapeHtml(rental.tipo_tarifa || '—')}</td>
          <td>${escapeHtml(money(rental.valor_tarifa))}</td>
          <td>${escapeHtml(money(rental.valor_total))}</td>
          <td>${statusBadge(rental.estado || 'Pendiente')}</td>
          <td class="table-actions">${button}</td>
        </tr>
      `;
    }).join('');
  }

  // ----------------------------------------------------------
  // Historial de contratos y filtros
  // ----------------------------------------------------------

  function populateContractCustomerFilter() {
    const select = $('contractCustomerFilter');
    const previous = select.value;
    const uniqueCustomers = new Map();

    getContracts().forEach((contract) => {
      const customer = getCustomerForContract(contract);
      const key = customerFilterKey(customer);
      if (key !== 'unknown' && !uniqueCustomers.has(key)) {
        uniqueCustomers.set(key, customerDisplayName(customer));
      }
    });

    select.innerHTML = '<option value="">Todos los clientes</option>' +
      [...uniqueCustomers.entries()].map(([key, name]) =>
        `<option value="${escapeHtml(key)}">${escapeHtml(name)}</option>`
      ).join('');

    if ([...uniqueCustomers.keys()].includes(previous)) select.value = previous;
  }

  function renderContractHistory() {
    const tbody = $('contractHistoryBody');
    const contracts = [...getContracts()].sort((a, b) =>
      new Date(b.fecha_generacion || 0) - new Date(a.fecha_generacion || 0)
    );

    const customerFilter = $('contractCustomerFilter').value;
    const statusFilter = normalize($('contractStatusFilter').value);
    const from = $('contractDateFrom').value;
    const to = $('contractDateTo').value;

    if (from && to && from > to) {
      tbody.innerHTML = '<tr><td colspan="11" class="history-empty">La fecha inicial no puede ser posterior a la fecha final.</td></tr>';
      showContractHistoryMessage('Revisa el rango de fechas seleccionado.', 'warning');
      return;
    }

    const filtered = contracts.filter((contract) => {
      const customer = getCustomerForContract(contract);
      if (customerFilter && customerFilterKey(customer) !== customerFilter) return false;
      if (statusFilter && normalize(contract.estado) !== statusFilter) return false;

      const generated = dateOnly(contract.fecha_generacion);
      if (from && (!generated || generated < from)) return false;
      if (to && (!generated || generated > to)) return false;
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="history-empty">${contracts.length ? 'No hay contratos que coincidan con los filtros.' : 'Todavía no hay contratos generados.'}</td></tr>`;
      hideContractHistoryMessage();
      return;
    }

    tbody.innerHTML = filtered.map((contract) => {
      const customer = getCustomerForContract(contract);
      const vehicle = getVehicleForRental(
        getRentals().find((rental) => String(rental.id_alquiler) === String(contract.id_alquiler))
      ) || contract.vehiculo || null;

      return `
        <tr>
          <td><strong>${escapeHtml(contract.numero_contrato || 'Sin número')}</strong></td>
          <td>${escapeHtml(customer.nombre || 'Cliente no vinculado')}</td>
          <td>${escapeHtml(customer.apellido || '—')}</td>
          <td class="client-email-cell">${escapeHtml(customer.correo || 'No disponible')}</td>
          <td>${escapeHtml(getVehicleName(vehicle))}</td>
          <td>${escapeHtml(formatDateTime(contract.fecha_generacion))}</td>
          <td>${escapeHtml(formatDateTime(contract.fecha_inicio))}</td>
          <td>${escapeHtml(formatDateTime(contract.fecha_fin))}</td>
          <td>${escapeHtml(money(contract.valor_total))}</td>
          <td>${statusBadge(contract.estado || 'Pendiente de generación')}</td>
          <td class="table-actions">
            <button type="button" class="btn-table btn-table-secondary" data-action="view-contract" data-number="${escapeHtml(contract.numero_contrato)}">Ver contrato</button>
          </td>
        </tr>
      `;
    }).join('');

    hideContractHistoryMessage();
  }

  // ----------------------------------------------------------
  // Eventos de tabla y formulario
  // ----------------------------------------------------------

  function handleRentalTableClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    if (button.dataset.action === 'create-contract') {
      createContractForRental(button.dataset.rental);
      return;
    }

    if (button.dataset.action === 'view-contract') {
      const contract = getContracts().find(
        (item) => String(item.numero_contrato) === String(button.dataset.number)
      );
      if (contract) selectContract(contract, true);
    }
  }

  function handleContractTableClick(event) {
    const button = event.target.closest('[data-action="view-contract"]');
    if (!button) return;

    const contract = getContracts().find(
      (item) => String(item.numero_contrato) === String(button.dataset.number)
    );
    if (contract) selectContract(contract, true);
  }

  function initializeEvents() {
    $('rentalHistoryBody').addEventListener('click', handleRentalTableClick);
    $('contractHistoryBody').addEventListener('click', handleContractTableClick);

    $('rentalSearch').addEventListener('input', renderRentalHistory);
    $('rentalStatusFilter').addEventListener('change', renderRentalHistory);
    $('clearRentalSearchBtn').addEventListener('click', () => {
      $('rentalSearch').value = '';
      $('rentalStatusFilter').value = '';
      renderRentalHistory();
    });

    $('contractFilterForm').addEventListener('submit', (event) => {
      event.preventDefault();
      renderContractHistory();
    });

    $('contractCustomerFilter').addEventListener('change', renderContractHistory);
    $('contractStatusFilter').addEventListener('change', renderContractHistory);
    $('contractDateFrom').addEventListener('change', renderContractHistory);
    $('contractDateTo').addEventListener('change', renderContractHistory);

    $('clearContractFiltersBtn').addEventListener('click', () => {
      $('contractCustomerFilter').value = '';
      $('contractStatusFilter').value = '';
      $('contractDateFrom').value = '';
      $('contractDateTo').value = '';
      renderContractHistory();
    });

    $('contractDetailsForm').addEventListener('submit', (event) => {
      event.preventDefault();
      saveContract(true);
    });

    $('downloadContractBtn').addEventListener('click', downloadPrintableContract);
    $('archivoContrato').addEventListener('change', handlePdfSelected);
    $('archivoContratoLink').addEventListener('click', handlePdfLinkClick);
  }

  // ----------------------------------------------------------
  // Inicialización
  // ----------------------------------------------------------

  async function loadData() {
    try {
      const response = await requestApi('GET', { action: 'init' });
      rentals = response.alquileres;
      contracts = response.contratos;
      csrfToken = response.csrf_token;
      currentContract = findContractFromUrl();
      renderContractDetails();
      renderRentalHistory();
      populateContractCustomerFilter();
      renderContractHistory();
    } catch (error) {
      showMessage(error.message, 'danger');
      $('rentalHistoryBody').innerHTML = '<tr><td colspan="11" class="history-empty">No fue posible cargar los alquileres.</td></tr>';
      $('contractHistoryBody').innerHTML = '<tr><td colspan="11" class="history-empty">No fue posible cargar los contratos.</td></tr>';
    }
  }

  function init() {
    initializeEvents();
    void loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
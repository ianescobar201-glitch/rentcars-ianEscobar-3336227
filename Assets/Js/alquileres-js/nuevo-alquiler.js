(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const API_URL = '../../controllers/alquileres/nuevo.php';

  let csrfToken = '';
  let reservations = [];
  let rentals = [];
  let selectedReservation = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function showMessage(message, type = 'info') {
    const element = $('pageMessage');
    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.classList.remove('d-none');
  }

  function hideMessage() {
    $('pageMessage').classList.add('d-none');
  }

  function showHistoryMessage(message, type = 'info') {
    const element = $('historyMessage');
    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.classList.remove('d-none');
  }

  function showRentalHistoryMessage(message, type = 'info') {
    const element = $('rentalHistoryMessage');
    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.classList.remove('d-none');
  }

  function hideRentalHistoryMessage() {
    $('rentalHistoryMessage').classList.add('d-none');
  }

  async function requestApi(method, params = {}) {
    const options = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };

    let url = API_URL;

    if (method === 'GET') {
      url += `?action=${encodeURIComponent(params.action)}`;
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

  function parseDateTime(value) {
    const text = String(value || '').replace(' ', 'T');
    const timestamp = new Date(text).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function parseCopAmount(value) {
    let text = String(value || '')
      .trim()
      .replace(/COP/gi, '')
      .replace(/[$\s\u00a0]/g, '');

    if (!text || !/^[\d.,]+$/.test(text)) {
      return null;
    }

    const hasComma = text.includes(',');
    const hasDot = text.includes('.');

    if (hasComma && hasDot) {
      const decimalSeparator = text.lastIndexOf(',') > text.lastIndexOf('.')
        ? ','
        : '.';
      const decimalPosition = text.lastIndexOf(decimalSeparator);
      const integerPart = text.slice(0, decimalPosition);
      const decimalPart = text.slice(decimalPosition + 1);
      const validInteger = /^\d+$/.test(integerPart)
        || /^\d{1,3}(?:[.,]\d{3})+$/.test(integerPart);

      if (!validInteger || !/^\d{1,2}$/.test(decimalPart)) {
        return null;
      }

      text = `${integerPart.replace(/[.,]/g, '')}.${decimalPart}`;
    } else if (hasComma || hasDot) {
      const separator = hasComma ? ',' : '.';
      const groupedNumber = new RegExp(`^\\d{1,3}(?:\\${separator}\\d{3})+$`);

      if (groupedNumber.test(text)) {
        text = text.replace(/[.,]/g, '');
      } else {
        const decimalNumber = new RegExp(`^\\d+\\${separator}\\d{1,2}$`);

        if (!decimalNumber.test(text)) {
          return null;
        }

        text = text.replace(separator, '.');
      }
    }

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function formatCopNumber(value, minimumFractionDigits = 0) {
    return Number(value).toLocaleString('es-CO', {
      minimumFractionDigits,
      maximumFractionDigits: 2
    });
  }

  function parseReservationDateTime(value) {
    const match = String(value || '').match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/
    );

    if (!match) {
      return null;
    }

    const [, year, month, day, hour, minute] = match;
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    );
  }

  function formatDateTime(value) {
    const text = String(value || '');
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);

    if (!match) {
      return escapeHtml(value || '—');
    }

    return `${match[3]}/${match[2]}/${match[1]}<br><span class="text-muted">${match[4]}:${match[5]}</span>`;
  }

  function toDateTimeLocal(value) {
    return String(value || '').replace(' ', 'T').slice(0, 16);
  }

  function formatAmount(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return '—';
    }

    return `${number.toLocaleString('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })} COP`;
  }

  function statusClass(status) {
    const normalized = String(status || '').toLowerCase();

    if (normalized.includes('pendiente')) {
      return 'pending';
    }
    if (normalized.includes('cancel')) {
      return 'cancelled';
    }
    if (normalized.includes('completado')) {
      return 'completed';
    }
    if (normalized.includes('convertida') || normalized.includes('inactivo')) {
      return 'converted';
    }
    if (normalized.includes('activo')) {
      return 'confirmed';
    }

    return '';
  }

  function customerLabel(customer) {
    if (!customer) {
      return 'Cliente no vinculado';
    }

    return `${customer.nombre || ''} ${customer.apellido || ''}`.trim()
      || customer.correo
      || 'Cliente no vinculado';
  }

  function renderVehicle(vehicle) {
    const image = $('vehiclePhoto');
    const placeholder = $('vehiclePhotoPlaceholder');

    if (!vehicle) {
      $('vehicleName').textContent = 'Ningún vehículo seleccionado';
      $('vehicleCategory').textContent = 'Categoría: —';
      $('vehiclePlate').textContent = '—';
      $('vehicleBrand').textContent = '—';
      $('vehicleModel').textContent = '—';
      $('vehicleYear').textContent = '—';
      $('vehicleColor').textContent = '—';
      $('vehicleStatus').textContent = 'Sin seleccionar';
      $('vehicleStatus').classList.remove('not-available');
      image.removeAttribute('src');
      image.classList.add('d-none');
      placeholder.classList.remove('d-none');
      $('registerRentalBtn').disabled = true;
      return;
    }

    $('vehicleName').textContent =
      `${vehicle.marca || ''} ${vehicle.modelo || ''}`.trim() || 'Vehículo seleccionado';
    $('vehicleCategory').textContent = `Categoría: ${vehicle.categoria || 'Sin categoría'}`;
    $('vehiclePlate').textContent = vehicle.placa || 'No especificada';
    $('vehicleBrand').textContent = vehicle.marca || 'No especificada';
    $('vehicleModel').textContent = vehicle.modelo || 'No especificado';
    $('vehicleYear').textContent = vehicle.anio || 'No especificado';
    $('vehicleColor').textContent = vehicle.color || 'No especificado';
    $('vehicleStatus').textContent = vehicle.disponible
      ? 'Disponible para esta reserva'
      : (vehicle.estado || 'No disponible');
    $('vehicleStatus').classList.toggle('not-available', !vehicle.disponible);

    if (typeof vehicle.foto === 'string' && vehicle.foto !== '') {
      image.onerror = () => {
        image.onerror = null;
        image.removeAttribute('src');
        image.classList.add('d-none');
        placeholder.classList.remove('d-none');
      };
      image.src = vehicle.foto;
      image.alt = `Foto de ${vehicle.marca || ''} ${vehicle.modelo || ''}`;
      image.classList.remove('d-none');
      placeholder.classList.add('d-none');
    } else {
      image.removeAttribute('src');
      image.classList.add('d-none');
      placeholder.classList.remove('d-none');
    }

    $('registerRentalBtn').disabled = !vehicle.disponible;
  }

  function renderCustomer(customer) {
    $('customerName').textContent = customer?.nombre || 'Cliente no vinculado';
    $('customerLastName').textContent = customer?.apellido || '—';
    $('customerEmail').textContent = customer?.correo || 'No disponible';
    $('customerRole').textContent = customer?.rol || '—';
    $('customerStatus').textContent = customer?.estado || 'No disponible';
  }

  function renderReservationHistory() {
    const body = $('reservationHistoryBody');

    if (!reservations.length) {
      body.innerHTML = '<tr><td colspan="7" class="history-empty">Todavía no hay reservas registradas.</td></tr>';
      return;
    }

    body.innerHTML = reservations.map((reservation) => {
      const vehicle = reservation.vehiculo || {};
      const status = reservation.estado || 'No disponible';
      const canConvert = Number(reservation.estado_codigo) === 0
        && reservation.puede_convertir
        && parseDateTime(reservation.fecha_fin) > Date.now();
      let action = '<span class="history-note">Sin acciones</span>';

      if (Number(reservation.estado_codigo) === 0) {
        const cancelButton = `<button type="button" class="btn-history cancel" data-action="cancel-reservation" data-id="${escapeHtml(reservation.id_reserva)}">Cancelar reserva</button>`;
        const convertButton = canConvert
          ? `<button type="button" class="btn-history convert" data-action="select-reservation" data-id="${escapeHtml(reservation.id_reserva)}">Convertir en alquiler</button>`
          : '<span class="history-note">No disponible para convertir</span>';
        action = `${cancelButton}${convertButton}`;
      }

      return `
        <tr>
          <td>${escapeHtml(`${vehicle.marca || ''} ${vehicle.modelo || ''}`.trim() || 'Vehículo no encontrado')}</td>
          <td>${escapeHtml(vehicle.categoria || 'Sin categoría')}</td>
          <td>${escapeHtml(customerLabel(reservation.cliente))}</td>
          <td>${formatDateTime(reservation.fecha_inicio)}</td>
          <td>${formatDateTime(reservation.fecha_fin)}</td>
          <td><span class="status-label ${statusClass(status)}">${escapeHtml(status)}</span></td>
          <td>${action}</td>
        </tr>
      `;
    }).join('');
  }

  function clearSelection() {
    selectedReservation = null;
    renderVehicle(null);
    renderCustomer(null);
    $('rentalForm').reset();
    $('rentalForm').classList.remove('was-validated');
    $('valorTarifa').setCustomValidity('');
    $('valorTotal').value = '';
    $('estadoAlquiler').value = 'Activo';
  }

  function selectReservation(reservationId) {
    const reservation = reservations.find(
      (item) => String(item.id_reserva) === String(reservationId)
    );

    if (!reservation || Number(reservation.estado_codigo) !== 0) {
      showHistoryMessage('Solo puedes convertir reservas pendientes.', 'warning');
      return;
    }

    if (!reservation.puede_convertir || parseDateTime(reservation.fecha_fin) <= Date.now()) {
      showHistoryMessage('La reserva venció o el vehículo no está disponible para convertirla.', 'warning');
      return;
    }

    selectedReservation = reservation;
    renderVehicle(reservation.vehiculo);
    renderCustomer(reservation.cliente);
    $('fechaEntrega').value = toDateTimeLocal(reservation.fecha_inicio);
    $('fechaDevolucion').value = toDateTimeLocal(reservation.fecha_fin);
    $('kilometrajeInicial').value = '';
    $('tipoTarifa').value = '';
    $('valorTarifa').value = '';
    $('valorTarifa').setCustomValidity('');
    $('valorTotal').value = '';
    $('estadoAlquiler').value = parseDateTime(reservation.fecha_fin) > Date.now()
      ? 'Activo'
      : 'Inactivo';
    $('rentalForm').classList.remove('was-validated');
    $('registerRentalBtn').disabled = false;
    showHistoryMessage('Reserva seleccionada. Ingresa el tipo y valor de la tarifa.', 'success');
    $('rentalForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function calculateTotal() {
    const start = parseReservationDateTime($('fechaEntrega').value);
    const end = parseReservationDateTime($('fechaDevolucion').value);
    const rate = parseCopAmount($('valorTarifa').value);
    const type = $('tipoTarifa').value;

    if (
      start === null ||
      end === null ||
      end <= start ||
      rate === null ||
      rate <= 0 ||
      !['Por hora', 'Diaria'].includes(type)
    ) {
      $('valorTotal').value = '';
      return;
    }

    const seconds = (end - start) / 1000;
    const units = type === 'Por hora' ? seconds / 3600 : seconds / 86400;
    const total = Math.round(units * rate * 100) / 100;
    $('valorTotal').value = formatCopNumber(total, 2);
  }

  function formatTariffInput() {
    const amount = parseCopAmount($('valorTarifa').value);

    if (amount !== null && amount > 0) {
      $('valorTarifa').value = formatCopNumber(amount);
    }
    calculateTotal();
  }

  function updateRentalCustomerFilter() {
    const select = $('rentalCustomerFilter');
    const previous = select.value;
    const customers = new Map();

    rentals.forEach((rental) => {
      const customer = rental.cliente;
      if (customer) {
        customers.set(String(customer.id_usuario), customerLabel(customer));
      }
    });

    select.innerHTML = '<option value="">Todos los clientes</option>' +
      [...customers.entries()].map(([id, label]) =>
        `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
      ).join('');

    if (customers.has(previous)) {
      select.value = previous;
    }
  }

  function renderRentalHistory() {
    const body = $('rentalHistoryBody');
    const selectedCustomer = $('rentalCustomerFilter').value;
    const search = $('rentalSearch').value.trim().toLowerCase();
    const selectedStatus = $('rentalStatusFilter').value;
    const fromDate = $('rentalDeliveryFrom').value;
    const toDate = $('rentalDeliveryTo').value;

    if (fromDate && toDate && fromDate > toDate) {
      body.innerHTML = '<tr><td colspan="9" class="history-empty">Revisa el rango de fechas seleccionado.</td></tr>';
      showRentalHistoryMessage('La fecha inicial no puede ser posterior a la fecha final.', 'warning');
      return;
    }

    const filtered = rentals.filter((rental) => {
      const customer = rental.cliente || {};
      if (selectedCustomer && String(rental.cliente?.id_usuario) !== selectedCustomer) {
        return false;
      }

      const searchable = [
        customer.nombre,
        customer.apellido,
        customer.correo
      ].join(' ').toLowerCase();
      if (search && !searchable.includes(search)) {
        return false;
      }

      const status = String(rental.estado || '').trim().toLowerCase();
      if (selectedStatus === 'activo' && (!status.includes('activo') || status.includes('inactivo'))) {
        return false;
      }
      if (selectedStatus === 'cancelado' && !status.includes('cancel')) {
        return false;
      }
      if (selectedStatus === 'completado' && !status.includes('completado')) {
        return false;
      }

      const deliveryDate = String(rental.fecha_inicio || '').slice(0, 10);
      if (fromDate && deliveryDate < fromDate) {
        return false;
      }
      if (toDate && deliveryDate > toDate) {
        return false;
      }
      return true;
    });

    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="9" class="history-empty">${rentals.length
        ? 'No hay alquileres que coincidan con los filtros seleccionados.'
        : 'Todavía no hay alquileres registrados.'}</td></tr>`;
      hideRentalHistoryMessage();
      return;
    }

    body.innerHTML = filtered.map((rental) => {
      const status = rental.estado || 'Inactivo';
      const vehicle = rental.vehiculo || {};
      const actions = [
        `<button type="button" class="btn-view-customer" data-action="view-customer" data-id="${escapeHtml(rental.id_alquiler)}">Ver cliente</button>`,
        rental.puede_cancelar
          ? `<button type="button" class="btn-history cancel" data-action="cancel-rental" data-id="${escapeHtml(rental.id_alquiler)}">Cancelar alquiler</button>`
          : ''
      ].join('');

      return `
        <tr>
          <td>${escapeHtml(customerLabel(rental.cliente))}</td>
          <td>${escapeHtml(`${vehicle.marca || ''} ${vehicle.modelo || ''}`.trim() || 'Vehículo no encontrado')}</td>
          <td>${formatDateTime(rental.fecha_inicio)}</td>
          <td>${formatDateTime(rental.fecha_fin)}</td>
          <td>${escapeHtml(rental.tipo_tarifa || '—')}</td>
          <td>${escapeHtml(formatAmount(rental.valor_tarifa))}</td>
          <td>${escapeHtml(formatAmount(rental.valor_total))}</td>
          <td><span class="status-label ${statusClass(status)}">${status}</span></td>
          <td>${actions}</td>
        </tr>
      `;
    }).join('');

    hideRentalHistoryMessage();
  }

  function showRentalCustomerDetails(rentalId) {
    const rental = rentals.find((item) => String(item.id_alquiler) === String(rentalId));

    if (!rental) {
      showRentalHistoryMessage('No se encontraron los datos del alquiler.', 'warning');
      return;
    }

    $('customerDetailName').textContent = rental.cliente?.nombre || 'No disponible';
    $('customerDetailLastName').textContent = rental.cliente?.apellido || 'No disponible';
    $('customerDetailEmail').textContent = rental.cliente?.correo || 'No disponible';

    const dialog = $('customerDetailsDialog');
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'open');
    }
  }

  function closeCustomerDialog() {
    const dialog = $('customerDetailsDialog');
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  async function loadData(showError = true) {
    try {
      const data = await requestApi('GET', { action: 'init' });
      csrfToken = data.csrf_token;
      reservations = data.reservas;
      rentals = data.alquileres;
      renderReservationHistory();
      updateRentalCustomerFilter();
      renderRentalHistory();
      return true;
    } catch (error) {
      if (showError) {
        showMessage(error.message, 'danger');
      }
      $('reservationHistoryBody').innerHTML = '<tr><td colspan="7" class="history-empty">No fue posible cargar las reservas.</td></tr>';
      $('rentalHistoryBody').innerHTML = '<tr><td colspan="9" class="history-empty">No fue posible cargar los alquileres.</td></tr>';
      return false;
    }
  }

  async function handleRentalSubmit(event) {
    event.preventDefault();
    hideMessage();

    const form = $('rentalForm');
    form.classList.add('was-validated');

    if (!selectedReservation) {
      showMessage('Primero selecciona una reserva pendiente en el historial.', 'warning');
      return;
    }

    calculateTotal();

    const rate = parseCopAmount($('valorTarifa').value);
    const km = $('kilometrajeInicial').value.trim();
    const type = $('tipoTarifa').value;

    if (!type || !['Por hora', 'Diaria'].includes(type)) {
      showMessage('Selecciona una tarifa por hora o diaria.', 'danger');
      return;
    }

    if (rate === null || rate <= 0) {
      $('valorTarifa').setCustomValidity('Ingresa una tarifa válida mayor que cero.');
      $('valorTarifa').reportValidity();
      showMessage('El valor de la tarifa debe ser mayor que cero.', 'danger');
      return;
    }
    $('valorTarifa').setCustomValidity('');

    if (km !== '' && (!/^\d+$/.test(km) || !Number.isSafeInteger(Number(km)))) {
      $('kilometrajeInicial').reportValidity();
      showMessage('El kilometraje debe ser un entero igual o mayor que cero.', 'danger');
      return;
    }

    if (!$('valorTotal').value || !form.checkValidity()) {
      $('valorTotal').reportValidity();
      showMessage('Revisa los datos del formulario antes de continuar.', 'danger');
      return;
    }

    const button = $('registerRentalBtn');
    button.disabled = true;

    try {
      const data = await requestApi('POST', {
        action: 'convert',
        csrf_token: csrfToken,
        id_reserva: selectedReservation.id_reserva,
        tipo_tarifa: type,
        valor_tarifa: String(rate),
        kilometraje_inicial: km
      });

      clearSelection();
      const refreshed = await loadData(false);
      showMessage(
        refreshed
          ? `${data.mensaje} Total: ${formatAmount(data.valor_total)}.`
          : 'El alquiler se guardó, pero no se pudieron actualizar los historiales. Recarga la página.',
        refreshed ? 'success' : 'warning'
      );
      showHistoryMessage('La reserva fue convertida en alquiler.', 'success');
    } catch (error) {
      button.disabled = false;
      showMessage(error.message, 'danger');
      await loadData(false);
    }
  }

  function handleReservationHistoryClick(event) {
    const button = event.target.closest('[data-action]');

    if (!button) {
      return;
    }

    if (button.dataset.action === 'select-reservation') {
      selectReservation(button.dataset.id);
    } else if (button.dataset.action === 'cancel-reservation') {
      cancelReservation(button, button.dataset.id);
    }
  }

  async function cancelReservation(button, reservationId) {
    const reservation = reservations.find(
      (item) => String(item.id_reserva) === String(reservationId)
    );

    if (!reservation || Number(reservation.estado_codigo) !== 0) {
      showHistoryMessage('Solo se pueden cancelar reservas pendientes.', 'warning');
      return;
    }

    if (!window.confirm('¿Deseas cancelar esta reserva? Permanecerá en el historial como cancelada.')) {
      return;
    }

    button.disabled = true;

    try {
      const data = await requestApi('POST', {
        action: 'cancel',
        csrf_token: csrfToken,
        id_reserva: reservationId
      });

      if (String(selectedReservation?.id_reserva) === String(reservationId)) {
        clearSelection();
      }

      const refreshed = await loadData(false);
      showHistoryMessage(
        refreshed
          ? data.mensaje
          : 'La reserva se canceló, pero no se pudo actualizar el historial. Recarga la página.',
        refreshed ? 'success' : 'warning'
      );
    } catch (error) {
      showHistoryMessage(error.message, 'danger');
      await loadData(false);
    }
  }

  function handleRentalHistoryClick(event) {
    const button = event.target.closest('[data-action]');

    if (!button) {
      return;
    }

    if (button.dataset.action === 'view-customer') {
      showRentalCustomerDetails(button.dataset.id);
    } else if (button.dataset.action === 'cancel-rental') {
      cancelRental(button, button.dataset.id);
    }
  }

  async function cancelRental(button, rentalId) {
    const rental = rentals.find(
      (item) => String(item.id_alquiler) === String(rentalId)
    );

    if (!rental || !rental.puede_cancelar) {
      showRentalHistoryMessage('Solo se pueden cancelar alquileres activos.', 'warning');
      return;
    }

    if (!window.confirm('¿Deseas cancelar este alquiler? Se conservará en el historial y el vehículo quedará disponible.')) {
      return;
    }

    button.disabled = true;

    try {
      const data = await requestApi('POST', {
        action: 'cancel_rental',
        csrf_token: csrfToken,
        id_alquiler: rentalId
      });

      const refreshed = await loadData(false);
      showRentalHistoryMessage(
        refreshed
          ? data.mensaje
          : 'El alquiler se canceló, pero no se pudo actualizar el historial. Recarga la página.',
        refreshed ? 'success' : 'warning'
      );
    } catch (error) {
      showRentalHistoryMessage(error.message, 'danger');
      await loadData(false);
    }
  }

  function init() {
    renderVehicle(null);
    renderCustomer(null);

    $('rentalForm').addEventListener('submit', handleRentalSubmit);
    $('tipoTarifa').addEventListener('input', calculateTotal);
    $('tipoTarifa').addEventListener('change', calculateTotal);
    const handleTariffValueChange = () => {
      $('valorTarifa').setCustomValidity('');
      calculateTotal();
    };
    $('valorTarifa').addEventListener('input', handleTariffValueChange);
    $('valorTarifa').addEventListener('change', handleTariffValueChange);
    $('valorTarifa').addEventListener('blur', formatTariffInput);
    $('reservationHistoryBody').addEventListener('click', handleReservationHistoryClick);
    $('rentalHistoryBody').addEventListener('click', handleRentalHistoryClick);
    $('rentalDateFilterForm').addEventListener('submit', (event) => {
      event.preventDefault();
      renderRentalHistory();
    });
    $('rentalCustomerFilter').addEventListener('change', renderRentalHistory);
    $('rentalSearch').addEventListener('input', renderRentalHistory);
    $('rentalStatusFilter').addEventListener('change', renderRentalHistory);
    $('clearRentalDateFilterBtn').addEventListener('click', () => {
      $('rentalSearch').value = '';
      $('rentalCustomerFilter').value = '';
      $('rentalStatusFilter').value = '';
      $('rentalDeliveryFrom').value = '';
      $('rentalDeliveryTo').value = '';
      renderRentalHistory();
    });
    $('backBtn').addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        showMessage('No hay una página anterior disponible.', 'info');
      }
    });
    $('closeCustomerDialog').addEventListener('click', closeCustomerDialog);
    $('closeCustomerDialogFooter').addEventListener('click', closeCustomerDialog);
    $('customerDetailsDialog').addEventListener('click', (event) => {
      if (event.target === $('customerDetailsDialog')) {
        closeCustomerDialog();
      }
    });

    loadData();
    window.setInterval(() => {
      loadData(false);
    }, 60000);
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
})();

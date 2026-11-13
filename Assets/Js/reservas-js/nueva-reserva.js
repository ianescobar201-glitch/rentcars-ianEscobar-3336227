(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const API_URL = '../../controllers/reservas/nueva.php';
  const SELECTED_VEHICLE_KEY = 'rentcars_vehiculo_seleccionado';

  let selectedVehicle = null;
  let reservations = [];
  let csrfToken = '';
  let submitted = false;

  // Comunica la pantalla con el controlador y muestra un error si el servidor no responde correctamente.
  async function requestApi(method, params = {}) {
    const url = new URL(API_URL, window.location.href);
    const options = {
      method,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store'
    };

    if (method === 'GET') {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
      });
    } else {
      const body = new FormData();
      Object.entries(params).forEach(([key, value]) => {
        body.set(key, String(value));
      });
      options.body = body;
    }

    const response = await fetch(url, options);
    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error('El servidor devolvió una respuesta inválida.');
    }

    if (!response.ok || data.ok !== true) {
      throw new Error(data.mensaje || 'No fue posible completar la solicitud.');
    }

    return data;
  }

  async function refreshHistory(allowNewSubmission = false) {
    const params = { action: 'init' };

    if (selectedVehicle) {
      params.id = selectedVehicle.id_vehiculo;
    }

    const data = await requestApi('GET', params);
    csrfToken = data.csrf_token;
    reservations = data.reservas;

    if (data.vehiculo) {
      data.vehiculo.usuario_tiene_reserva_activa =
        data.usuario_tiene_reserva_activa === true;
      renderVehicle(data.vehiculo);

      const available =
        String(data.vehiculo.estado || '').trim().toLowerCase() === 'disponible' &&
        Number(data.vehiculo.reserva_pendiente_activa) !== 1 &&
        !data.vehiculo.usuario_tiene_reserva_activa;

      if (allowNewSubmission && available) {
        submitted = false;
        $('confirmReservationBtn').textContent = 'Confirmar reserva';
      }
    }

    renderHistory();

    return data;
  }

  // Proteger el contenido que se inserta en HTML.
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  // Mostrar mensajes del formulario.
  function showMessage(message, type = 'info') {
    const element = $('reservationMessage');

    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.classList.remove('d-none');
  }

  // Mostrar mensajes del historial.
  function showHistoryMessage(message, type = 'info') {
    const element = $('historyMessage');

    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.classList.remove('d-none');
  }

  // Formatear una fecha local como YYYY-MM-DDTHH:mm.
  function toLocalDateTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  // Obtener el momento mínimo para poder iniciar una reserva.
  function getMinimumDateTime() {
    const now = new Date();

    if (now.getSeconds() > 0 || now.getMilliseconds() > 0) {
      now.setMinutes(now.getMinutes() + 1);
    }

    now.setSeconds(0, 0);

    return toLocalDateTime(now);
  }

  // Consultar el nombre de una categoría.
  function getCategoryName(categoryId) {
    return selectedVehicle &&
      String(selectedVehicle.id_categoria) === String(categoryId)
      ? selectedVehicle.categoria || 'Sin categoría'
      : 'Sin categoría';
  }

  // Buscar el vehículo asociado a una reserva.
  function getReservationVehicle(reservation) {
    return selectedVehicle &&
      String(selectedVehicle.id_vehiculo) === String(reservation.id_vehiculo)
      ? selectedVehicle
      : null;
  }

  // Mostrar fecha y hora en el historial.
  function formatDateTime(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return '—';
    }

    const match = value.trim().match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/
    );

    if (!match) {
      return escapeHtml(value);
    }

    const [, year, month, day, hour, minute] = match;
    const dateText = `${day}/${month}/${year}`;

    // Las reservas antiguas pueden tener únicamente la fecha.
    if (hour === undefined || minute === undefined) {
      return `
        <span>${dateText}</span>
        <br>
        <span class="time-unavailable">Hora no registrada</span>
      `;
    }

    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute)
    );

    const timeText = date.toLocaleTimeString('es-CO', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    return `${dateText}, ${escapeHtml(timeText)}`;
  }

  // Asignar el estilo correspondiente al estado de la reserva.
  function getHistoryStatusClass(status) {
    const normalized = String(status || '').trim().toLowerCase();

    if (normalized === 'pendiente') {
      return 'status-pending';
    }

    if (
      normalized === 'confirmada' ||
      normalized === 'confirmado'
    ) {
      return 'status-confirmed';
    }

    if (normalized.includes('cancel')) {
      return 'status-cancelled';
    }

    if (normalized.includes('completado')) {
      return 'status-completed';
    }

    return 'status-other';
  }

  // Dibujar el historial de reservas.
  function renderHistory() {
    const tbody = $('reservationHistoryBody');

    if (!reservations.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="history-empty">
            Todavía no tienes reservas registradas.
          </td>
        </tr>
      `;

      return;
    }

    // Ordenar desde la solicitud más reciente.
    const sortedReservations = [...reservations].sort(
      (a, b) => Number(b.id_reserva) - Number(a.id_reserva)
    );

    tbody.innerHTML = sortedReservations.map((reservation) => {
      const vehicle = getReservationVehicle(reservation);

      const vehicleName = vehicle
        ? `${vehicle.marca || ''} ${vehicle.modelo || ''}`.trim()
        : (reservation.vehiculo_nombre || 'Vehículo no disponible');

      const categoryName = vehicle
        ? getCategoryName(vehicle.id_categoria)
        : (reservation.vehiculo_categoria || 'Sin categoría');

      const status = reservation.estado || 'Pendiente';
      const normalizedStatus = String(status).trim().toLowerCase();

      const isCancelled = normalizedStatus.includes('cancel');

      const isConverted =
        normalizedStatus.includes('convertida en alquiler') ||
        normalizedStatus.includes('alquiler registrado') ||
        normalizedStatus.includes('completado');

      const safeId = escapeHtml(reservation.id_reserva);

      let actions;

      if (isCancelled) {
        actions = `
          <button
            type="button"
            class="btn-delete-history"
            data-action="delete-reservation"
            data-id="${safeId}"
          >
            Eliminar
          </button>
        `;
      } else if (isConverted) {
        actions = `
          <span class="cancelled-note">
            ${normalizedStatus.includes('completado') ? 'Alquiler completado' : 'Alquiler registrado'}
          </span>
        `;
      } else {
        actions = `
          <button
            type="button"
            class="btn-cancel-history"
            data-action="cancel-reservation"
            data-id="${safeId}"
          >
            Cancelar reserva
          </button>
        `;
      }

      return `
        <tr>
          <td>
            <span class="history-vehicle-name">
              ${escapeHtml(vehicleName)}
            </span>
          </td>

          <td>
            ${escapeHtml(categoryName)}
          </td>

          <td class="history-date-time">
            ${formatDateTime(reservation.fecha_inicio)}
          </td>

          <td class="history-date-time">
            ${formatDateTime(reservation.fecha_fin)}
          </td>

          <td>
            <span class="history-status ${getHistoryStatusClass(status)}">
              ${escapeHtml(status)}
            </span>
          </td>

          <td>
            <div class="history-actions">
              ${actions}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Mostrar un aviso cuando no existe un vehículo seleccionado.
  function showEmptyState(title, description) {
    $('reservationContent').classList.add('d-none');
    $('emptyState').classList.remove('d-none');

    $('emptyTitle').textContent = title;
    $('emptyDescription').textContent = description;
  }

  // Mostrar la imagen del vehículo o el marcador de imagen.
  function renderPhoto(vehicle) {
    const image = $('vehiclePhoto');
    const placeholder = $('vehiclePhotoPlaceholder');

    image.onerror = () => {
      image.onerror = null;
      image.removeAttribute('src');
      image.classList.add('d-none');
      placeholder.classList.remove('d-none');
    };

    const photo = typeof vehicle.foto === 'string'
      ? vehicle.foto
      : '';

    if (photo) {
      image.src = photo;
      image.alt = `Foto de ${vehicle.marca || ''} ${vehicle.modelo || ''}`.trim();

      image.classList.remove('d-none');
      placeholder.classList.add('d-none');
    } else {
      image.removeAttribute('src');
      image.classList.add('d-none');
      placeholder.classList.remove('d-none');
    }
  }

  // Cargar los datos del vehículo seleccionado.
  function renderVehicle(vehicle) {
    selectedVehicle = vehicle;

    $('vehicleName').textContent =
      `${vehicle.marca || ''} ${vehicle.modelo || ''}`.trim();

    $('vehicleCategory').textContent =
      getCategoryName(vehicle.id_categoria);

    $('vehicleBrand').textContent =
      vehicle.marca || 'No especificada';

    $('vehicleModel').textContent =
      vehicle.modelo || 'No especificado';

    $('vehicleYear').textContent =
      vehicle.anio || vehicle.año || 'No especificado';

    const available =
      String(vehicle.estado || '').trim().toLowerCase() === 'disponible' &&
      Number(vehicle.reserva_pendiente_activa) !== 1 &&
      !vehicle.usuario_tiene_reserva_activa;

    const badge = $('vehicleStatusBadge');

    badge.textContent = available
      ? 'Disponible'
      : 'No disponible';

    badge.classList.toggle('not-available', !available);

    renderPhoto(vehicle);

    $('reservationStatus').textContent = 'Pendiente';
    $('confirmReservationBtn').disabled = !available;

    $('reservationContent').classList.remove('d-none');
    $('emptyState').classList.add('d-none');

    if (available) {
      $('reservationMessage').classList.add('d-none');
    } else if (vehicle.usuario_tiene_reserva_activa) {
      showMessage(
        'reservationMessage',
        'Ya tienes una reserva o alquiler vigente. Podrás reservar otro vehículo cuando termine o se cancele.',
        'warning'
      );
    } else {
      showMessage(
        'Este vehículo no está disponible para reservar.',
        'warning'
      );
    }
  }

  // El identificador de la URL selecciona el vehículo que el servidor vuelve a consultar.
  function loadSelectedVehicle(vehicle, vehicleId) {
    if (!vehicleId) {
      showEmptyState(
        'No has seleccionado un vehículo',
        'Regresa al catálogo y selecciona el vehículo que deseas reservar.'
      );

      return;
    }

    if (!vehicle) {
      showEmptyState(
        'Vehículo no encontrado',
        'No encontramos el vehículo en los registros. Regresa al catálogo y selecciónalo de nuevo.'
      );

      return;
    }

    renderVehicle(vehicle);
  }

  // Validar las fechas y horas seleccionadas.
  function validateDates() {
    const start = $('startDate');
    const end = $('endDate');
    const minDateTime = getMinimumDateTime();

    start.setCustomValidity('');
    end.setCustomValidity('');

    // No permite iniciar una reserva en el pasado.
    start.min = minDateTime;

    if (!start.value) {
      start.setCustomValidity(
        'Selecciona una fecha y hora de inicio.'
      );
    } else if (start.value < minDateTime) {
      start.setCustomValidity(
        'La fecha y hora de inicio no pueden estar en el pasado.'
      );
    }

    if (!end.value) {
      end.setCustomValidity(
        'Selecciona una fecha y hora de fin.'
      );
    } else if (!start.value) {
      end.setCustomValidity(
        'Primero selecciona una fecha y hora de inicio.'
      );
    } else if (end.value <= start.value) {
      end.setCustomValidity(
        'La fecha y hora de fin deben ser posteriores a las de inicio.'
      );
    }

    // El fin no puede ser anterior al inicio.
    end.min = start.value || minDateTime;
  }

  // Comprobar que el formulario sea válido.
  function checkForm() {
    const form = $('reservationForm');

    validateDates();
    form.classList.add('was-validated');

    if (!form.checkValidity()) {
      form.reportValidity();

      showMessage(
        'Revisa las fechas y horas. La finalización debe ser posterior al inicio y ambas deben estar completas.',
        'danger'
      );

      return false;
    }

    return true;
  }

  // Registrar la solicitud de reserva.
  async function handleSubmit(event) {
    event.preventDefault();

    if (submitted || !selectedVehicle) {
      return;
    }

    if (!checkForm()) {
      return;
    }

    const button = $('confirmReservationBtn');
    button.disabled = true;

    try {
      await requestApi('POST', {
        action: 'create',
        csrf_token: csrfToken,
        id_vehiculo: selectedVehicle.id_vehiculo,
        fecha_inicio: $('startDate').value,
        fecha_fin: $('endDate').value
      });

      submitted = true;
      button.textContent = 'Solicitud registrada';
      showMessage(
        'Tu solicitud se registró con estado Pendiente. La confirmación final será realizada por un empleado.',
        'success'
      );
    } catch (error) {
      console.error('No se pudo registrar la solicitud de reserva.', error);
      showMessage(error.message, 'danger');
      button.disabled = false;
      return;
    }

    try {
      await refreshHistory();
    } catch (error) {
      console.error('No se pudo actualizar el historial de reservas.', error);
      showHistoryMessage(error.message, 'danger');
    }
  }

  // Cancelar una reserva.
  async function cancelReservation(id) {
    const confirmed = window.confirm(
      '¿Deseas cancelar esta reserva?'
    );

    if (!confirmed) {
      return;
    }

    try {
      const data = await requestApi('POST', {
        action: 'cancel',
        csrf_token: csrfToken,
        id_reserva: id
      });

      const cancelledReservation = reservations.find(
        (reservation) => String(reservation.id_reserva) === String(id)
      );
      const cancelledSelectedVehicle =
        cancelledReservation &&
        selectedVehicle &&
        String(cancelledReservation.id_vehiculo) ===
          String(selectedVehicle.id_vehiculo);

      await refreshHistory(Boolean(cancelledSelectedVehicle));
      showHistoryMessage(data.mensaje, 'success');
    } catch (error) {
      console.error('No se pudo cancelar la reserva.', error);
      showHistoryMessage(error.message, 'danger');
    }
  }

  // Eliminar una reserva solamente si ya está cancelada.
  async function deleteReservation(id) {
    const confirmed = window.confirm(
      '¿Seguro que deseas eliminar esta reserva cancelada del historial?'
    );

    if (!confirmed) {
      return;
    }

    try {
      const data = await requestApi('POST', {
        action: 'delete',
        csrf_token: csrfToken,
        id_reserva: id
      });
      await refreshHistory();
      showHistoryMessage(data.mensaje, 'success');
    } catch (error) {
      console.error('No se pudo eliminar la reserva cancelada.', error);
      showHistoryMessage(error.message, 'danger');
    }
  }

  // Detectar los clics en las acciones del historial.
  function handleHistoryActions(event) {
    const button = event.target.closest('[data-action]');

    if (!button) {
      return;
    }

    const { action, id } = button.dataset;

    if (action === 'cancel-reservation') {
      cancelReservation(id);
    }

    if (action === 'delete-reservation') {
      deleteReservation(id);
    }
  }

  // Regresar al catálogo.
  function returnToCatalog() {
    window.location.href = '../vehiculos/detalle-vehiculo.html';
  }

  // Conectar los eventos de la pantalla.
  function initializeEvents() {
    $('reservationForm').addEventListener(
      'submit',
      handleSubmit
    );

    $('startDate').addEventListener('change', () => {
      validateDates();

      $('reservationForm').classList.remove('was-validated');
      $('reservationMessage').classList.add('d-none');
    });

    $('endDate').addEventListener('change', () => {
      validateDates();

      $('reservationForm').classList.remove('was-validated');
      $('reservationMessage').classList.add('d-none');
    });

    $('cancelReservationBtn').addEventListener(
      'click',
      returnToCatalog
    );

    $('returnCatalogBtn').addEventListener(
      'click',
      returnToCatalog
    );

    $('reservationHistoryBody').addEventListener(
      'click',
      handleHistoryActions
    );
  }

  // Inicializar la pantalla.
  async function init() {
    const minDateTime = getMinimumDateTime();

    $('startDate').min = minDateTime;
    $('endDate').min = minDateTime;

    initializeEvents();

    const params = { action: 'init' };
    const query = new URLSearchParams(window.location.search);
    let vehicleId = query.get('id') || query.get('id_vehiculo') || '';

    if (!vehicleId) {
      try {
        vehicleId = sessionStorage.getItem(SELECTED_VEHICLE_KEY) || '';
      } catch (error) {
        console.warn('No se pudo recuperar el vehículo seleccionado.', error);
      }
    }

    if (vehicleId) {
      try {
        sessionStorage.removeItem(SELECTED_VEHICLE_KEY);
      } catch (error) {
        console.warn('No se pudo limpiar el respaldo del vehículo seleccionado.', error);
      }
    }

    if (vehicleId) {
      params.id = vehicleId;
    }

    showMessage('Cargando los datos de la reserva...', 'info');

    try {
      const data = await requestApi('GET', params);
      csrfToken = data.csrf_token;
      reservations = data.reservas;
      loadSelectedVehicle(data.vehiculo, vehicleId);
      renderHistory();

      if (
        !data.vehiculo ||
        (
          String(data.vehiculo.estado || '').trim().toLowerCase() === 'disponible' &&
          Number(data.vehiculo.reserva_pendiente_activa) !== 1 &&
          data.usuario_tiene_reserva_activa !== true
        )
      ) {
        $('reservationMessage').classList.add('d-none');
      }
    } catch (error) {
      console.error('No se pudo cargar la pantalla de reservas.', error);
      showEmptyState(
        'No se pudo cargar la reserva',
        'Inténtalo de nuevo o vuelve al catálogo de vehículos.'
      );
      showMessage(error.message, 'danger');
      showHistoryMessage(error.message, 'danger');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
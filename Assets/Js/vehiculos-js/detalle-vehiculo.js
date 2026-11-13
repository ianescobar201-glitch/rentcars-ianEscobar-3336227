(() => {
  'use strict';

  const API_URL = '../../controllers/vehiculos/detalle-vehiculo.php?action=list';

  const $ = (id) => document.getElementById(id);

  let vehicles = [];
  let categories = [];
  let currentVehicle = null;
  let userHasActiveReservation = false;

  // Proteger el HTML frente a datos introducidos por usuarios.
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  // Buscar una categoría.
  function findCategory(categoryId) {
    return categories.find(
      (category) => category.id_categoria === categoryId
    );
  }

  // Mostrar solamente el nombre de la categoría.
  function getCategoryName(categoryId) {
    const category = findCategory(categoryId);

    return category ? category.nombre : 'Sin categoría';
  }

  // Nombre del estado que verá el cliente.
  function getVehicleStatus(vehicle) {
    if (
      userHasActiveReservation ||
      Number(vehicle.reserva_pendiente_activa) === 1
    ) {
      return 'No disponible';
    }

    const validStatuses = [
      'Disponible',
      'Alquilado',
      'En mantenimiento'
    ];

    if (validStatuses.includes(vehicle.estado)) {
      return vehicle.estado;
    }

    return 'No disponible';
  }

  // Indicar la disponibilidad registrada del vehículo.
  function isAvailable(vehicle) {
    return vehicle.estado === 'Disponible' &&
      !userHasActiveReservation &&
      Number(vehicle.reserva_pendiente_activa) !== 1;
  }

  // Formatear cantidades.
  function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return 'No especificado';
    }

    return number.toLocaleString('es-CO');
  }

  // Mostrar mensajes.
  function showMessage(elementId, message, type = 'info') {
    const element = $(elementId);

    element.className = `alert alert-${type}`;
    element.textContent = message;
    element.classList.remove('d-none');
  }

  // Crear el selector de categorías.
  function renderCategoryFilter() {
    const select = $('categoryFilter');
    const selectedValue = select.value;

    const sorted = [...categories].sort((a, b) =>
      String(a.nombre).localeCompare(String(b.nombre), 'es')
    );

    select.innerHTML =
      '<option value="">Todas las categorías</option>';

    sorted.forEach((category) => {
      const option = document.createElement('option');

      // El identificador sirve para filtrar, pero nunca se muestra.
      option.value = category.id_categoria;
      option.textContent = category.nombre;

      select.appendChild(option);
    });

    select.value = sorted.some(
      (category) => category.id_categoria === selectedValue
    )
      ? selectedValue
      : '';
  }

  // Aplicar los filtros elegidos por el cliente.
  function applyFilters(event) {
    if (event) {
      event.preventDefault();
    }

    const transmission = $('transmissionFilter').value;
    const categoryId = $('categoryFilter').value;
    const passengers = Number($('passengerFilter').value || 0);
    const fuel = $('fuelFilter').value;

    const filteredVehicles = vehicles.filter((vehicle) => {
      const matchesTransmission =
        !transmission || vehicle.transmision === transmission;

      const matchesCategory =
        !categoryId ||
        String(vehicle.id_categoria) === String(categoryId);

      const matchesPassengers =
        !passengers || Number(vehicle.capacidad) >= passengers;

      const matchesFuel =
        !fuel || vehicle.combustible === fuel;

      return (
        matchesTransmission &&
        matchesCategory &&
        matchesPassengers &&
        matchesFuel
      );
    });

    renderCatalog(filteredVehicles);
  }

  // Si no hay foto, se utiliza el marcador visual.
  function photoMarkup(vehicle, prefix = 'catalog') {
    const photo = typeof vehicle.foto === 'string' &&
      vehicle.foto !== ''
        ? vehicle.foto
        : '';

    const imageClass = photo ? '' : 'd-none';
    const placeholderClass = photo ? 'd-none' : '';

    return `
      <img
        class="${prefix}-photo ${imageClass}"
        src="${escapeHTML(photo)}"
        alt="Foto de ${escapeHTML(vehicle.marca)} ${escapeHTML(vehicle.modelo)}"
        data-vehicle-image
      >

      <div
        class="${prefix}-photo-placeholder ${placeholderClass}"
        data-photo-placeholder
      >
        <span aria-hidden="true">🚘</span>
        <p>No hay una foto disponible.</p>
      </div>
    `;
  }

  // Sustituir una imagen que no se pueda mostrar por el marcador.
  function attachPhotoFallbacks(root) {
    root.querySelectorAll('[data-vehicle-image]').forEach((image) => {
      image.addEventListener('error', () => {
        image.classList.add('d-none');

        const container = image.parentElement;
        const placeholder = container.querySelector(
          '[data-photo-placeholder]'
        );

        if (placeholder) {
          placeholder.classList.remove('d-none');
        }
      }, { once: true });
    });
  }

  // Crear una tarjeta de vehículo.
  function vehicleCard(vehicle) {
    const available = isAvailable(vehicle);
    const status = getVehicleStatus(vehicle);

    return `
      <div class="col-12 col-sm-6 col-xl-4">

        <article class="card vehicle-card">

          <div class="catalog-photo-container">

            <span class="vehicle-status-badge ${
              available ? '' : 'not-available'
            }">
              ${escapeHTML(available ? 'Disponible' : 'No disponible')}
            </span>

            ${photoMarkup(vehicle)}

          </div>

          <div class="card-body">

            <h3 class="vehicle-card-title">
              ${escapeHTML(vehicle.marca)} ${escapeHTML(vehicle.modelo)}
            </h3>

            <p class="vehicle-card-subtitle">
              Año ${escapeHTML(vehicle.anio || 'No especificado')}
              · ${escapeHTML(getCategoryName(vehicle.id_categoria))}
            </p>

            <div class="vehicle-card-data">

              <p>
                <span>Estado</span>
                <strong>${escapeHTML(status)}</strong>
              </p>

              <p>
                <span>Transmisión</span>
                <strong>${escapeHTML(vehicle.transmision || 'No especificada')}</strong>
              </p>

              <p>
                <span>Pasajeros</span>
                <strong>${escapeHTML(vehicle.capacidad || 'No especificado')}</strong>
              </p>

              <p>
                <span>Combustible</span>
                <strong>${escapeHTML(vehicle.combustible || 'No especificado')}</strong>
              </p>

            </div>

            <button
              type="button"
              class="btn btn-view-detail"
              data-action="view-detail"
              data-id="${escapeHTML(vehicle.id_vehiculo)}"
            >
              Ver detalle
            </button>

          </div>
        </article>

      </div>
    `;
  }

  // Renderizar el catálogo.
  function renderCatalog(list) {
    const grid = $('vehiclesGrid');
    const empty = $('catalogEmpty');

    $('resultsCount').textContent =
      `${list.length} ${list.length === 1 ? 'vehículo' : 'vehículos'}`;

    if (list.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('d-none');

      if (vehicles.length === 0) {
        $('catalogEmptyTitle').textContent =
          'Todavía no hay vehículos registrados';

        $('catalogEmptyDescription').textContent =
          'Cuando se registren vehículos en el módulo Vehículos, aparecerán aquí.';
      } else {
        $('catalogEmptyTitle').textContent =
          'No se encontraron vehículos';

        $('catalogEmptyDescription').textContent =
          'No hay vehículos que coincidan con los filtros seleccionados. Prueba con otros criterios o muestra todos los vehículos.';
      }

      return;
    }

    empty.classList.add('d-none');

    grid.innerHTML = list.map(vehicleCard).join('');

    attachPhotoFallbacks(grid);
  }

  // Mostrar un vehículo seleccionado.
  function renderVehicleDetail(vehicle) {
    currentVehicle = vehicle;

    const available = isAvailable(vehicle);
    const image = $('vehicleImage');
    const placeholder = $('photoPlaceholder');

    $('vehicleName').textContent =
      `${vehicle.marca || ''} ${vehicle.modelo || ''}`.trim();

    $('vehicleSubtitle').textContent =
      `${getCategoryName(vehicle.id_categoria)} · Año ${
        vehicle.anio || 'No especificado'
      }`;

    $('availabilityBadge').textContent =
      available ? 'Disponible' : 'No disponible';

    $('availabilityBadge').classList.toggle(
      'not-available',
      !available
    );

    const photo = typeof vehicle.foto === 'string' &&
      vehicle.foto !== ''
        ? vehicle.foto
        : '';

    image.onerror = () => {
      image.classList.add('d-none');
      image.removeAttribute('src');
      placeholder.classList.remove('d-none');
    };

    if (photo) {
      image.src = photo;
      image.alt = `Foto de ${vehicle.marca} ${vehicle.modelo}`;

      image.classList.remove('d-none');
      placeholder.classList.add('d-none');
    } else {
      image.removeAttribute('src');
      image.classList.add('d-none');
      placeholder.classList.remove('d-none');
    }

    const specifications = [
      ['Marca', vehicle.marca],
      ['Modelo', vehicle.modelo],
      ['Año', vehicle.anio],
      ['Color', vehicle.color],
      ['Categoría', getCategoryName(vehicle.id_categoria)],
      ['Combustible', vehicle.combustible],
      ['Transmisión', vehicle.transmision],
      [
        'Capacidad',
        vehicle.capacidad
          ? `${vehicle.capacidad} pasajeros`
          : 'No especificada'
      ],
      [
        'Kilometraje actual',
        vehicle.kilometraje !== undefined &&
        vehicle.kilometraje !== null &&
        vehicle.kilometraje !== ''
          ? `${formatNumber(vehicle.kilometraje)} km`
          : 'No especificado'
      ],
      ['Estado', getVehicleStatus(vehicle)]
    ];

    $('vehicleSpecs').innerHTML = specifications.map(([label, value]) => `
      <div class="spec-row">
        <span class="spec-label">${escapeHTML(label)}</span>
        <span class="spec-value">${escapeHTML(value || 'No especificado')}</span>
      </div>
    `).join('');

    $('reservationHelp').textContent = available
      ? 'Este vehículo está disponible para iniciar una reserva.'
      : 'Este vehículo no está disponible para reservar en este momento.';
    $('reserveVehicleBtn').disabled = !available;
    $('reserveVehicleBtn').textContent = available
      ? 'Reservar vehículo'
      : 'Vehículo no disponible';

    $('catalogView').classList.add('d-none');
    $('notFoundView').classList.add('d-none');
    $('detailView').classList.remove('d-none');

    $('detailMessage').classList.add('d-none');

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // Abrir el detalle mediante el identificador de la URL.
  function openVehicleDetail(id) {
    const vehicle = vehicles.find(
      (item) => String(item.id_vehiculo) === String(id)
    );

    if (!vehicle) {
      window.location.href =
        `${window.location.pathname}?vehiculoNoEncontrado=1`;

      return;
    }

    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('id', id);

    window.history.pushState({}, '', url);

    renderVehicleDetail(vehicle);
  }

  // Volver al catálogo.
  function showCatalog() {
    currentVehicle = null;

    $('detailView').classList.add('d-none');
    $('notFoundView').classList.add('d-none');
    $('catalogView').classList.remove('d-none');

    const url = new URL(window.location.href);
    url.search = '';

    window.history.pushState({}, '', url);

    renderCatalog(vehicles);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // Determinar si se muestra catálogo o detalle al abrir la página.
  function loadInitialView() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');

    if (id) {
      const vehicle = vehicles.find(
        (item) => String(item.id_vehiculo) === id
      );

      if (vehicle) {
        renderVehicleDetail(vehicle);
      } else {
        $('catalogView').classList.add('d-none');
        $('detailView').classList.add('d-none');
        $('notFoundView').classList.remove('d-none');
      }

      return;
    }

    $('detailView').classList.add('d-none');
    $('notFoundView').classList.add('d-none');
    $('catalogView').classList.remove('d-none');

    renderCatalog(vehicles);
  }

  // Inicializar eventos y cargar el catálogo desde la base de datos.
  async function init() {
    $('filtersForm').addEventListener('submit', applyFilters);

    $('resetFiltersBtn').addEventListener('click', () => {
      $('filtersForm').reset();
      renderCatalog(vehicles);
      $('catalogMessage').classList.add('d-none');
    });

    $('emptyResetFiltersBtn').addEventListener('click', () => {
      $('filtersForm').reset();
      renderCatalog(vehicles);
    });

    $('vehiclesGrid').addEventListener('click', (event) => {
      const button = event.target.closest(
        '[data-action="view-detail"]'
      );

      if (button) {
        openVehicleDetail(button.dataset.id);
      }
    });

    $('backToCatalogBtn').addEventListener('click', showCatalog);
    $('returnCatalogBtn').addEventListener('click', showCatalog);

    $('reserveVehicleBtn').addEventListener('click', () => {
      if (!currentVehicle || !isAvailable(currentVehicle)) {
        return;
      }

      const reservationUrl = new URL(
        '../reservas/nueva.html',
        window.location.href
      );
      reservationUrl.searchParams.set('id', currentVehicle.id_vehiculo);

      try {
        sessionStorage.setItem(
          'rentcars_vehiculo_seleccionado',
          String(currentVehicle.id_vehiculo)
        );
      } catch (error) {
        console.warn('No se pudo guardar el vehículo seleccionado como respaldo.', error);
      }

      window.location.href = reservationUrl.href;
    });

    // Actualizar la vista al usar atrás o adelante en el navegador.
    window.addEventListener('popstate', loadInitialView);

    showMessage('catalogMessage', 'Cargando vehículos disponibles...', 'info');

    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store'
      });
      const data = await response.json();

      if (!response.ok || data.ok !== true) {
        throw new Error(data.mensaje || 'No fue posible cargar el catálogo.');
      }

      if (!Array.isArray(data.vehiculos) || !Array.isArray(data.categorias)) {
        throw new Error('El servidor devolvió datos incompletos.');
      }

      vehicles = data.vehiculos;
      categories = data.categorias;
      userHasActiveReservation = data.usuario_tiene_reserva_activa === true;

      renderCategoryFilter();
      $('catalogMessage').classList.add('d-none');
      if (userHasActiveReservation) {
        showMessage(
          'catalogMessage',
          'Ya tienes una reserva o alquiler vigente. Podrás reservar otro vehículo cuando termine o se cancele.',
          'warning'
        );
      }
      loadInitialView();
    } catch (error) {
      console.error('No se pudo cargar el catálogo de vehículos.', error);
      $('vehiclesGrid').innerHTML = '';
      $('catalogEmpty').classList.add('d-none');
      $('resultsCount').textContent = '0 vehículos';
      showMessage(
        'catalogMessage',
        error.message || 'No se pudo conectar con el catálogo de vehículos.',
        'danger'
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
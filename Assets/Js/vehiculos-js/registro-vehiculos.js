(() => {
  'use strict';

  // Elementos del HTML
  const $ = (id) => document.getElementById(id);

  const API_URL = '../../controllers/vehiculos/registro-vehiculos.php';
  const MAX_FILE_SIZE = 2 * 1024 * 1024;

  const state = {
    vehicles: [],
    categories: [],
    photo: '',
    csrfToken: ''
  };

  let removeExistingPhoto = false;

  // Evitar interpretar los datos como HTML
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));
  }

  async function requestApi(data) {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: data,
      credentials: 'same-origin'
    });

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error('El servidor devolvió una respuesta inválida.');
    }

    if (!response.ok || !result.ok) {
      throw new Error(result.mensaje || 'No fue posible completar la solicitud.');
    }

    return result;
  }

  async function loadData() {
    const response = await fetch(`${API_URL}?action=list`, {
      credentials: 'same-origin',
      cache: 'no-store'
    });

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error('El servidor devolvió una respuesta inválida.');
    }

    if (!response.ok || !result.ok) {
      throw new Error(result.mensaje || 'No fue posible cargar los vehículos.');
    }

    state.csrfToken = result.csrf_token;
    state.categories = result.categorias;
    state.vehicles = result.vehiculos;
  }

  async function refreshVehicleList() {
    try {
      await loadData();
      renderAll();
    } catch (error) {
      console.error('Error al actualizar los vehículos:', error);
      showMessage(
        error.message || 'No se pudieron actualizar los datos de vehículos.',
        'error'
      );
    }
  }

  // Mostrar mensajes
  function showMessage(message, type = 'success', category = false) {
    const element = category
      ? $('categoryMessage')
      : $('message');

    if (!element) return;

    element.className =
      `alert alert-${type === 'error' ? 'danger' : 'success'}`;

    element.textContent = message;

    clearTimeout(element.messageTimer);

    element.messageTimer = setTimeout(() => {
      element.classList.add('d-none');
    }, 4000);
  }

  // Buscar una categoría por su identificador
  function findCategory(id) {
    return state.categories.find(
      (category) => String(category.id_categoria) === String(id)
    );
  }

  // Obtener el nombre de una categoría
  function categoryName(id) {
    const category = findCategory(id);
    return category ? category.nombre : 'Sin categoría';
  }

  // El estado operativo se mantiene para edición; el estado mostrado incluye reservas activas.
  function getDisplayedStatus(vehicle) {
    return vehicle.estado_mostrado || vehicle.estado;
  }

  // Contar los vehículos de una categoría
  function countCategoryVehicles(id) {
    return state.vehicles.filter(
      (vehicle) => String(vehicle.id_categoria) === String(id)
    ).length;
  }

  // Actualizar el selector de categorías del formulario y el filtro
  function renderCategoryOptions(selectedId) {
    const categorySelect = $('categoria');
    const filterSelect = $('filterCategory');

    if (selectedId === undefined) {
      selectedId = categorySelect.value;
    }

    const previousFilter = filterSelect.value;

    const categories = [...state.categories].sort(
      (a, b) => a.nombre.localeCompare(b.nombre, 'es')
    );

    categorySelect.innerHTML =
      '<option value="">Selecciona una categoría</option>';

    categories.forEach((category) => {
      // Las categorías inactivas solo se conservan al editar
      // un vehículo que ya tenga esa categoría asignada.
      const isSelected =
        String(category.id_categoria) === String(selectedId);

      if (category.estado !== 'Activa' && !isSelected) {
        return;
      }

      const option = document.createElement('option');

      option.value = category.id_categoria;
      option.textContent =
        category.nombre +
        (category.estado === 'Activa' ? '' : ' (Inactiva)');

      categorySelect.appendChild(option);
    });

    categorySelect.value = selectedId || '';

    filterSelect.innerHTML =
      '<option value="">Todas las categorías</option>';

    categories.forEach((category) => {
      const option = document.createElement('option');

      option.value = category.id_categoria;
      option.textContent = category.nombre;

      filterSelect.appendChild(option);
    });

    filterSelect.value = previousFilter;
  }

  // Actualizar los números del resumen
  function renderSummary() {
    $('totalVehicles').textContent = state.vehicles.length;

    $('availableVehicles').textContent =
      state.vehicles.filter(
        (vehicle) => getDisplayedStatus(vehicle) === 'Disponible'
      ).length;

    $('totalCategories').textContent =
      state.categories.filter(
        (category) => category.estado === 'Activa'
      ).length;
  }

  // Clase visual según el estado
  function getStatusClass(status) {
    const classes = {
      'Disponible': 'status-disponible',
      'Reservado': 'status-reservado',
      'Alquilado': 'status-alquilado',
      'En mantenimiento': 'status-mantenimiento',
      'Inactivo': 'status-inactivo'
    };

    return classes[status] || 'status-inactivo';
  }

  // Mostrar vehículos en la tabla
  function renderVehicles() {
    const search = $('vehicleSearch').value
      .trim()
      .toLocaleLowerCase('es');

    const categoryFilter = $('filterCategory').value;
    const statusFilter = $('filterStatus').value;

    const filtered = state.vehicles.filter((vehicle) => {
      const matchesSearch =
        vehicle.placa.toLocaleLowerCase('es').includes(search) ||
        vehicle.modelo.toLocaleLowerCase('es').includes(search);

      const matchesCategory =
        !categoryFilter ||
        String(vehicle.id_categoria) === String(categoryFilter);

      const matchesStatus =
        !statusFilter ||
        getDisplayedStatus(vehicle) === statusFilter;

      return matchesSearch && matchesCategory && matchesStatus;
    });

    const tbody = $('vehiclesTableBody');

    if (filtered.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');

      cell.colSpan = 8;
      cell.className = 'text-center py-4 text-secondary';
      cell.textContent = state.vehicles.length
        ? 'No se encontraron vehículos con esos filtros.'
        : 'No hay vehículos registrados.';

      row.appendChild(cell);
      tbody.replaceChildren(row);
    } else {
      tbody.innerHTML = filtered.map((vehicle) => `
        <tr>
          <td>${escapeHTML(vehicle.placa)}</td>
          <td>${escapeHTML(vehicle.marca)}</td>
          <td>${escapeHTML(vehicle.modelo)}</td>
          <td>${escapeHTML(vehicle.anio)}</td>
          <td>${escapeHTML(vehicle.color)}</td>
          <td>${escapeHTML(categoryName(vehicle.id_categoria))}</td>

          <td>
            <span class="vehicle-status ${getStatusClass(getDisplayedStatus(vehicle))}">
              ${escapeHTML(getDisplayedStatus(vehicle))}
            </span>
          </td>

          <td>
            <button
              type="button"
              class="btn btn-edit"
              data-action="edit"
              data-id="${escapeHTML(vehicle.id_vehiculo)}"
            >
              Editar
            </button>

            <button
              type="button"
              class="btn btn-delete"
              data-action="delete"
              data-id="${escapeHTML(vehicle.id_vehiculo)}"
            >
              Eliminar
            </button>
          </td>
        </tr>
      `).join('');
    }

    $('tableResultLabel').textContent =
      `Mostrando ${filtered.length} de ${state.vehicles.length} vehículos`;

    renderSummary();
  }

  // Mostrar categorías dentro del modal
  function renderCategories() {
    const container = $('categoriesList');

    if (state.categories.length === 0) {
      container.innerHTML = `
        <p class="text-secondary">
          No hay categorías registradas.
        </p>
      `;
    } else {
      const categories = [...state.categories].sort(
        (a, b) => a.nombre.localeCompare(b.nombre, 'es')
      );

      container.innerHTML = categories.map((category) => {
        const used = countCategoryVehicles(category.id_categoria);

        const statusClass = category.estado === 'Activa'
          ? 'category-active'
          : 'category-inactive';

        return `
          <div class="category-item">
            <div class="category-info">
              <strong>${escapeHTML(category.nombre)}</strong>

              <small>
                ${escapeHTML(category.descripcion || 'Sin descripción')}
              </small>

              <small class="${statusClass}">
                ${escapeHTML(category.estado)}
                · ${used} vehículo(s) asignado(s)
              </small>
            </div>

            <div class="category-actions">
              <button
                type="button"
                class="btn btn-edit"
                data-action="edit-category"
                data-id="${escapeHTML(category.id_categoria)}"
              >
                Editar
              </button>

              <button
                type="button"
                class="btn btn-delete"
                data-action="delete-category"
                data-id="${escapeHTML(category.id_categoria)}"
              >
                Eliminar
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    renderCategoryOptions();
    renderSummary();
  }

  // Actualizar todos los listados
  function renderAll() {
    renderCategoryOptions();
    renderCategories();
    renderVehicles();
  }

  // Limpiar la vista previa de la foto
  function clearPhoto() {
    state.photo = '';

    $('fotoVehiculo').value = '';
    $('photoPreview').src = '';
    $('photoPreview').classList.add('d-none');
    $('photoPlaceholder').classList.remove('d-none');
    $('removePhotoBtn').classList.add('d-none');
  }

  // Mostrar la vista previa de una foto
  function displayPhoto(photo) {
    state.photo = photo || '';
    removeExistingPhoto = false;

    if (state.photo) {
      $('photoPreview').src = state.photo;
      $('photoPreview').classList.remove('d-none');
      $('photoPlaceholder').classList.add('d-none');
      $('removePhotoBtn').classList.remove('d-none');
    } else {
      $('photoPreview').src = '';
      $('photoPreview').classList.add('d-none');
      $('photoPlaceholder').classList.remove('d-none');
      $('removePhotoBtn').classList.add('d-none');
    }
  }

  // Limpiar el formulario de vehículos
  function resetVehicleForm() {
    $('vehicleForm').reset();
    $('vehicleForm').classList.remove('was-validated');

    $('vehicleId').value = '';
    $('formTitle').textContent = 'Registrar vehículo';
    $('submitVehicleBtn').textContent = 'Registrar vehículo';
    removeExistingPhoto = false;

    $('placa').setCustomValidity('');
    $('categoria').setCustomValidity('');

    clearPhoto();
    renderCategoryOptions('');
  }

  // Registrar un vehículo o actualizar uno existente
  async function handleVehicleSubmit(event) {
    event.preventDefault();

    const form = $('vehicleForm');
    const id = $('vehicleId').value;
    const placa = $('placa').value.trim().toUpperCase();

    $('placa').value = placa;

    $('anio').max = String(new Date().getFullYear() + 1);

    // Evitar placas duplicadas
    const duplicate = state.vehicles.some(
      (vehicle) =>
        vehicle.placa.toUpperCase() === placa &&
        String(vehicle.id_vehiculo) !== String(id)
    );

    $('placa').setCustomValidity(
      duplicate ? 'Esta placa ya está registrada.' : ''
    );

    // Comprobar la categoría seleccionada
    const category = findCategory($('categoria').value);

    const previousVehicle = state.vehicles.find(
      (vehicle) => String(vehicle.id_vehiculo) === String(id)
    );

    const validCategory =
      category &&
      (
        category.estado === 'Activa' ||
        (
          previousVehicle &&
          String(previousVehicle.id_categoria) ===
            String(category.id_categoria)
        )
      );

    $('categoria').setCustomValidity(
      validCategory ? '' : 'Selecciona una categoría activa.'
    );

    form.classList.add('was-validated');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = new FormData();
    data.append('action', 'vehicle_save');
    data.append('csrf_token', state.csrfToken);
    data.append('id_vehiculo', id);
    data.append('placa', placa);
    data.append('marca', $('marca').value.trim());
    data.append('modelo', $('modelo').value.trim());
    data.append('anio', $('anio').value);
    data.append('color', $('color').value.trim());
    data.append('combustible', $('combustible').value);
    data.append('transmision', $('transmision').value);
    data.append('capacidad', $('capacidad').value);
    data.append('kilometraje', $('kilometraje').value);
    data.append('estado', $('estadoVehiculo').value);
    data.append('id_categoria', $('categoria').value);
    data.append('remove_photo', removeExistingPhoto ? '1' : '0');

    const photo = $('fotoVehiculo').files[0];
    if (photo) {
      data.append('foto_vehiculo', photo);
    }

    try {
      const result = await requestApi(data);
      await loadData();
      resetVehicleForm();
      $('vehicleSearch').value = '';
      $('filterCategory').value = '';
      $('filterStatus').value = '';
      renderAll();
      showMessage(result.mensaje);
    } catch (error) {
      console.error('Error al guardar el vehículo:', error);
      showMessage(error.message || 'No se pudo guardar el vehículo.', 'error');
    }
  }

  // Cargar un vehículo para editar
  function editVehicle(id) {
    const vehicle = state.vehicles.find(
      (item) => String(item.id_vehiculo) === String(id)
    );

    if (!vehicle) return;

    $('vehicleId').value = vehicle.id_vehiculo;
    $('placa').value = vehicle.placa;
    $('marca').value = vehicle.marca;
    $('modelo').value = vehicle.modelo;
    $('anio').value = vehicle.anio;
    $('color').value = vehicle.color;
    $('combustible').value = vehicle.combustible;
    $('transmision').value = vehicle.transmision;
    $('capacidad').value = vehicle.capacidad;
    $('kilometraje').value = vehicle.kilometraje;
    $('estadoVehiculo').value = vehicle.estado;

    renderCategoryOptions(vehicle.id_categoria);
    $('categoria').value = vehicle.id_categoria;

    $('formTitle').textContent = 'Editar vehículo';
    $('submitVehicleBtn').textContent = 'Guardar cambios';

    $('vehicleForm').classList.remove('was-validated');

    displayPhoto(vehicle.foto || '');

    $('vehicleForm').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  // Eliminar un vehículo
  async function deleteVehicle(id) {
    const vehicle = state.vehicles.find(
      (item) => String(item.id_vehiculo) === String(id)
    );

    if (!vehicle) return;

    const confirmation = confirm(
      `¿Deseas eliminar el vehículo ${vehicle.placa}?`
    );

    if (!confirmation) return;

    const data = new FormData();
    data.append('action', 'vehicle_delete');
    data.append('csrf_token', state.csrfToken);
    data.append('id_vehiculo', id);

    try {
      const result = await requestApi(data);
      await loadData();

      if (String($('vehicleId').value) === String(id)) {
        resetVehicleForm();
      }

      renderAll();
      showMessage(result.mensaje);
    } catch (error) {
      console.error('Error al desactivar el vehículo:', error);
      showMessage(error.message || 'No se pudo desactivar el vehículo.', 'error');
    }
  }

  // Limpiar el formulario de categorías
  function resetCategoryForm() {
    $('categoryForm').reset();
    $('categoryForm').classList.remove('was-validated');

    $('categoryId').value = '';
    $('categoryName').setCustomValidity('');
    $('saveCategoryBtn').textContent = 'Guardar categoría';

    $('cancelCategoryBtn').classList.add('d-none');
    $('categoryMessage').classList.add('d-none');
  }

  // Guardar una categoría nueva o editar una existente
  async function handleCategorySubmit(event) {
    event.preventDefault();

    const form = $('categoryForm');
    const id = $('categoryId').value;
    const name = $('categoryName').value.trim();

    const duplicate = state.categories.some(
      (category) =>
        category.nombre.toLocaleLowerCase('es') ===
          name.toLocaleLowerCase('es') &&
        String(category.id_categoria) !== String(id)
    );

    $('categoryName').setCustomValidity(
      duplicate ? 'Esta categoría ya existe.' : ''
    );

    form.classList.add('was-validated');

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const data = new FormData();
    data.append('action', 'category_save');
    data.append('csrf_token', state.csrfToken);
    data.append('id_categoria', id);
    data.append('nombre', name);
    data.append('descripcion', $('categoryDescription').value.trim());
    data.append('estado', $('categoryStatus').value);

    try {
      const result = await requestApi(data);
      await loadData();
      resetCategoryForm();
      renderAll();
      showMessage(result.mensaje, 'success', true);
    } catch (error) {
      console.error('Error al guardar la categoría:', error);
      showMessage(
        error.message || 'No se pudo guardar la categoría.',
        'error',
        true
      );
    }
  }

  // Cargar una categoría para editar
  function editCategory(id) {
    const category = findCategory(id);

    if (!category) return;

    $('categoryId').value = category.id_categoria;
    $('categoryName').value = category.nombre;
    $('categoryDescription').value = category.descripcion || '';
    $('categoryStatus').value = category.estado;

    $('saveCategoryBtn').textContent = 'Guardar cambios';
    $('cancelCategoryBtn').classList.remove('d-none');

    $('categoryForm').classList.remove('was-validated');

    $('categoryName').focus();
  }

  // Eliminar una categoría
  async function deleteCategory(id) {
    const category = findCategory(id);

    if (!category) return;

    // Evitar dejar vehículos sin categoría
    if (countCategoryVehicles(id) > 0) {
      showMessage(
        'No puedes eliminar una categoría que tenga vehículos asignados. Puedes editarla y marcarla como inactiva.',
        'error',
        true
      );

      return;
    }

    if (!confirm(`¿Deseas eliminar la categoría "${category.nombre}"?`)) {
      return;
    }

    const data = new FormData();
    data.append('action', 'category_delete');
    data.append('csrf_token', state.csrfToken);
    data.append('id_categoria', id);

    try {
      const result = await requestApi(data);
      await loadData();
      resetCategoryForm();
      renderAll();
      showMessage(result.mensaje, 'success', true);
    } catch (error) {
      console.error('Error al eliminar la categoría:', error);
      showMessage(
        error.message || 'No se pudo eliminar la categoría.',
        'error',
        true
      );
    }
  }

  // Procesar los botones de la tabla
  function handleVehicleTableClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    const id = button.dataset.id;

    if (button.dataset.action === 'edit') {
      editVehicle(id);
    }

    if (button.dataset.action === 'delete') {
      deleteVehicle(id);
    }
  }

  // Procesar los botones del listado de categorías
  function handleCategoryClick(event) {
    const button = event.target.closest('button[data-action]');

    if (!button) return;

    const id = button.dataset.id;

    if (button.dataset.action === 'edit-category') {
      editCategory(id);
    }

    if (button.dataset.action === 'delete-category') {
      deleteCategory(id);
    }
  }

  // Leer y mostrar la foto seleccionada
  function handlePhotoChange(event) {
    const file = event.target.files[0];

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      event.target.value = '';

      showMessage('Selecciona un archivo de imagen válido.', 'error');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      event.target.value = '';

      showMessage('La foto no puede superar los 2 MB.', 'error');
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        displayPhoto(reader.result);
        removeExistingPhoto = false;
      }
    };

    reader.onerror = () => {
      showMessage('No se pudo leer la foto.', 'error');
    };

    reader.readAsDataURL(file);
  }

  // Inicializar eventos
  function initializeEvents() {
    $('vehicleForm').addEventListener(
      'submit',
      handleVehicleSubmit
    );

    $('categoryForm').addEventListener(
      'submit',
      handleCategorySubmit
    );

    $('vehiclesTableBody').addEventListener(
      'click',
      handleVehicleTableClick
    );

    $('categoriesList').addEventListener(
      'click',
      handleCategoryClick
    );

    // Abrir el modal de categorías
    $('openCategoriesBtn').addEventListener('click', () => {
      resetCategoryForm();
      renderCategories();

      bootstrap.Modal
        .getOrCreateInstance($('categoriesModal'))
        .show();
    });

    // Limpiar o cancelar la edición de vehículos
    $('clearVehicleBtn').addEventListener('click', () => {
      resetVehicleForm();
      showMessage('Formulario limpiado.');
    });

    // Cancelar la edición de categorías
    $('cancelCategoryBtn').addEventListener(
      'click',
      resetCategoryForm
    );

    // Previsualizar foto
    $('fotoVehiculo').addEventListener(
      'change',
      handlePhotoChange
    );

    // Quitar foto
    $('removePhotoBtn').addEventListener('click', () => {
      clearPhoto();
      removeExistingPhoto = true;
    });

    // Búsqueda
    $('vehicleSearch').addEventListener(
      'input',
      renderVehicles
    );

    // Filtros
    $('filterCategory').addEventListener(
      'change',
      renderVehicles
    );

    $('filterStatus').addEventListener(
      'change',
      renderVehicles
    );

    // Limpiar filtros
    $('resetFiltersBtn').addEventListener('click', () => {
      $('vehicleSearch').value = '';
      $('filterCategory').value = '';
      $('filterStatus').value = '';

      renderVehicles();
    });

    // Quitar el error de placa duplicada al modificarla
    $('placa').addEventListener('input', () => {
      $('placa').setCustomValidity('');
    });

    $('categoria').addEventListener('change', () => {
      $('categoria').setCustomValidity('');
    });

    $('categoryName').addEventListener('input', () => {
      $('categoryName').setCustomValidity('');
    });

    // Limpiar el formulario de categorías al cerrar el modal
    $('categoriesModal').addEventListener(
      'hidden.bs.modal',
      resetCategoryForm
    );
  }

  // Iniciar la página
  async function init() {
    $('anio').max = String(new Date().getFullYear() + 1);

    initializeEvents();

    await refreshVehicleList();
  }

  // Chrome puede restaurar esta vista desde su caché de navegación sin recargarla.
  // Al volver a ella se vuelve a consultar la disponibilidad actual al servidor.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      refreshVehicleList();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
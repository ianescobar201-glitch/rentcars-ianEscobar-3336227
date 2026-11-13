(() => {
  // Opciones informativas de alquiler asociadas a las categorías que ya existen.
  const services = [
    {
      name: 'Movilidad urbana',
      category: 'Economico',
      label: 'Económico',
      icon: 'bi-geo-alt',
      description: 'Alternativa de alquiler para desplazamientos cotidianos y recorridos dentro de la ciudad.',
      detail: 'La categoría económica está orientada a quienes buscan una opción práctica para sus actividades y trayectos urbanos. La disponibilidad y las condiciones se consultan al iniciar la gestión del alquiler.'
    },
    {
      name: 'Traslados y viajes cómodos',
      category: 'Sedán',
      label: 'Sedán',
      icon: 'bi-signpost-split',
      description: 'Opción para recorridos personales, laborales o viajes que requieren comodidad.',
      detail: 'El servicio de alquiler en categoría sedán se adapta a desplazamientos personales y viajes. Consulta las fechas disponibles y las condiciones correspondientes antes de confirmar.'
    },
    {
      name: 'Alquiler para viajes y grupos',
      category: 'SUV',
      label: 'SUV',
      icon: 'bi-compass',
      description: 'Una alternativa para recorridos en los que se valora el espacio y la versatilidad.',
      detail: 'La categoría SUV ofrece una opción para viajes y recorridos que requieren mayor espacio. Las características y disponibilidad dependen del vehículo asignado al alquiler.'
    },
    {
      name: 'Experiencia de conducción deportiva',
      category: 'Deportivo',
      label: 'Deportivo',
      icon: 'bi-speedometer2',
      description: 'Alquiler de categoría deportiva para quienes buscan una experiencia diferente.',
      detail: 'La categoría deportiva reúne opciones de alquiler con enfoque en una experiencia de conducción especial. Consulta disponibilidad, requisitos y condiciones antes de reservar.'
    },
    {
      name: 'Apoyo para carga y logística',
      category: 'Van-carga',
      label: 'Van de carga',
      icon: 'bi-box-seam',
      description: 'Alternativa de alquiler para apoyar traslados de objetos y actividades logísticas.',
      detail: 'La categoría van de carga está pensada para necesidades de transporte de objetos y apoyo logístico. La capacidad permitida y las condiciones deben confirmarse para el vehículo disponible.'
    }
  ];

  const grid = document.getElementById('service-grid');
  const search = document.getElementById('service-search');
  const filters = document.querySelectorAll('[data-category]');
  const results = document.getElementById('service-results');
  const emptyState = document.getElementById('service-empty');

  if (!grid || !search || !results || !emptyState) return;

  let selectedCategory = 'todas';

  // Filtra las opciones por categoría y texto, y dibuja las tarjetas coincidentes.
  function renderServices() {
    const query = search.value.trim().toLocaleLowerCase('es');
    const filteredServices = services.filter((service) => {
      const matchesCategory =
        selectedCategory === 'todas' || service.category === selectedCategory;
      const searchableText =
        `${service.name} ${service.label} ${service.description} ${service.detail}`.toLocaleLowerCase('es');
      return matchesCategory && searchableText.includes(query);
    });

    grid.replaceChildren();
    filteredServices.forEach((service) => {
      const column = document.createElement('div');
      column.className = 'col-12 col-md-6 col-xl-4';

      const card = document.createElement('article');
      card.className = 'card service-card';

      const body = document.createElement('div');
      body.className = 'card-body d-flex flex-column';

      const icon = document.createElement('span');
      icon.className = 'service-icon mb-3';
      icon.setAttribute('aria-hidden', 'true');

      const iconElement = document.createElement('i');
      iconElement.className = `bi ${service.icon}`;
      icon.append(iconElement);

      const category = document.createElement('span');
      category.className = 'service-category align-self-start';
      category.textContent = service.label;

      const title = document.createElement('h3');
      title.className = 'h5 fw-bold mt-3 mb-2';
      title.textContent = service.name;

      const description = document.createElement('p');
      description.className = 'text-secondary mb-0';
      description.textContent = service.description;

      const detailsButton = document.createElement('button');
      detailsButton.type = 'button';
      detailsButton.className = 'btn btn-outline-primary mt-auto mt-4';
      detailsButton.textContent = 'Ver detalles';
      detailsButton.addEventListener('click', () => showServiceDetails(service));

      body.append(icon, category, title, description, detailsButton);
      card.append(body);
      column.append(card);
      grid.append(column);
    });

    results.textContent = `${filteredServices.length} ${filteredServices.length === 1 ? 'servicio encontrado' : 'servicios encontrados'}`;
    emptyState.classList.toggle('d-none', filteredServices.length > 0);
  }

  // Actualiza el modal con la información del servicio elegido.
  function showServiceDetails(service) {
    const modal = document.getElementById('serviceDetailsModal');
    if (!modal) return;

    modal.querySelector('#serviceDetailsTitle').textContent = service.name;
    modal.querySelector('#serviceDetailsCategory').textContent = service.label;
    modal.querySelector('#serviceDetailsDescription').textContent = service.detail;
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  // Cambia el filtro activo y actualiza las tarjetas visibles.
  filters.forEach((button) => {
    button.addEventListener('click', () => {
      selectedCategory = button.dataset.category || 'todas';
      filters.forEach((filter) => {
        const isSelected = filter === button;
        filter.classList.toggle('active', isSelected);
        filter.classList.toggle('btn-primary', isSelected);
        filter.classList.toggle('btn-outline-primary', !isSelected);
        filter.setAttribute('aria-pressed', String(isSelected));
      });
      renderServices();
    });
  });

  // Busca mientras se escribe y muestra todos los servicios al cargar la página.
  search.addEventListener('input', renderServices);
  renderServices();
})();
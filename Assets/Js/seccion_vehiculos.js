(() => {
  // Catálogo informativo usado por las tarjetas y el modal de detalles.
  const vehicles = [
    {
      name: 'Kia Picanto',
      category: 'Economico',
      label: 'Económico',
      image: '../Assets/Images/Economico/Kia_Picanto.jpg',
      model: 'Picanto',
      year: '2022',
      seats: '4',
      transmission: 'Automática',
      fuel: 'Gasolina',
      description: 'Compacto y práctico, ideal para desplazamientos urbanos y recorridos diarios.'
    },
    {
      name: 'Mazda 3',
      category: 'Sedán',
      label: 'Sedán',
      image: '../Assets/Images/Sedán/Mazda_3.jpg',
      model: '3',
      year: '2015',
      seats: '4',
      transmission: 'Automática',
      fuel: 'Gasolina',
      description: 'Sedán cómodo y versátil, con espacio para disfrutar trayectos en la ciudad o carretera.'
    },
    {
      name: 'Toyota Corolla',
      category: 'Sedán',
      label: 'Sedán',
      image: '../Assets/Images/Sedán/Toyota_Corolla.jpg',
      model: 'No registrado',
      year: 'No registrado',
      seats: 'No registrado',
      transmission: 'No registrado',
      fuel: 'No registrado',
      description: 'Una alternativa familiar que combina comodidad interior y utilidad para viajes.'
    },
    {
      name: 'Chevrolet Captiva',
      category: 'SUV',
      label: 'SUV',
      image: '../Assets/Images/Suv/Chevrolet_Captiva.jpg',
      model: 'No registrado',
      year: 'No registrado',
      seats: 'No registrado',
      transmission: 'No registrado',
      fuel: 'No registrado',
      description: 'SUV espaciosa para quienes necesitan comodidad y capacidad en sus recorridos.'
    },
    {
      name: 'Ford Mustang',
      category: 'Deportivo',
      label: 'Deportivo',
      image: '../Assets/Images/Deportivo/Ford_Mustang.jpg',
      model: 'Mustang GT',
      year: '2015',
      seats: '2',
      transmission: 'Manual',
      fuel: 'Gasolina',
      description: 'Vehículo deportivo de diseño llamativo, pensado para una experiencia de conducción especial.'
    },
    {
      name: 'Ford Ranger',
      category: 'Van-carga',
      label: 'Van de carga',
      image: '../Assets/Images/Van-carga/Ford_Ranger.jpg',
      model: 'No registrado',
      year: 'No registrado',
      seats: 'No registrado',
      transmission: 'No registrado',
      fuel: 'No registrado',
      description: 'Vehículo de carga útil para apoyar actividades comerciales y transporte de objetos.'
    }
  ];

  const grid = document.getElementById('vehicle-grid');
  const search = document.getElementById('vehicle-search');
  const filters = document.querySelectorAll('[data-category]');
  const results = document.getElementById('vehicle-results');
  const emptyState = document.getElementById('vehicle-empty');

  if (!grid || !search || !results || !emptyState) return;

  let selectedCategory = 'todas';

  // Filtra por categoría y texto, y vuelve a dibujar únicamente los vehículos coincidentes.
  function renderVehicles() {
    const query = search.value.trim().toLocaleLowerCase('es');
    const filteredVehicles = vehicles.filter((vehicle) => {
      const matchesCategory =
        selectedCategory === 'todas' || vehicle.category === selectedCategory;
      const searchableText =
        `${vehicle.name} ${vehicle.label} ${vehicle.description}`.toLocaleLowerCase('es');
      return matchesCategory && searchableText.includes(query);
    });

    grid.replaceChildren();
    filteredVehicles.forEach((vehicle) => {
      const column = document.createElement('div');
      column.className = 'col-12 col-md-6 col-xl-4';

      const card = document.createElement('article');
      card.className = 'card vehicle-card';

      const image = document.createElement('img');
      image.className = 'vehicle-card-image';
      image.src = vehicle.image;
      image.alt = `${vehicle.name}, categoría ${vehicle.label}`;
      image.loading = 'lazy';

      const body = document.createElement('div');
      body.className = 'card-body';

      const badge = document.createElement('span');
      badge.className = 'vehicle-category';
      badge.textContent = vehicle.label;

      const title = document.createElement('h3');
      title.className = 'h5 fw-bold mt-3 mb-2';
      title.textContent = vehicle.name;

      const description = document.createElement('p');
      description.className = 'text-secondary mb-0';
      description.textContent = vehicle.description;

      const detailsButton = document.createElement('button');
      detailsButton.type = 'button';
      detailsButton.className = 'btn btn-outline-primary w-100 mt-3';
      detailsButton.textContent = 'Ver detalles';
      detailsButton.dataset.bsToggle = 'modal';
      detailsButton.dataset.bsTarget = '#vehicleDetailsModal';
      detailsButton.addEventListener('click', () => showVehicleDetails(vehicle));

      body.append(badge, title, description, detailsButton);
      card.append(image, body);
      column.append(card);
      grid.append(column);
    });

    results.textContent = `${filteredVehicles.length} ${filteredVehicles.length === 1 ? 'vehículo encontrado' : 'vehículos encontrados'}`;
    emptyState.classList.toggle('d-none', filteredVehicles.length > 0);
  }

  // Copia las especificaciones del vehículo elegido a la ventana modal de Bootstrap.
  function showVehicleDetails(vehicle) {
    const modal = document.getElementById('vehicleDetailsModal');
    if (!modal) return;

    modal.querySelector('#vehicleDetailsTitle').textContent = `Detalles de ${vehicle.name}`;
    modal.querySelector('[data-detail="model"]').textContent = vehicle.model;
    modal.querySelector('[data-detail="year"]').textContent = vehicle.year;
    modal.querySelector('[data-detail="seats"]').textContent = vehicle.seats;
    modal.querySelector('[data-detail="transmission"]').textContent = vehicle.transmission;
    modal.querySelector('[data-detail="fuel"]').textContent = vehicle.fuel;
  }

  // Actualiza el estado visual y el contenido del catálogo cuando se elige una categoría.
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
      renderVehicles();
    });
  });

  // La búsqueda se actualiza al escribir; la primera carga muestra todo el catálogo.
  search.addEventListener('input', renderVehicles);
  renderVehicles();
})();
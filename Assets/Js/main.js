// Assets/Js/main.js

function initComponents() {
  const basePath = getProjectBasePath();

  // Carga dinámica de componentes reutilizables (Header y Footer)
  loadComponent('header-container', `${basePath}components/header.html`, () => {
    fixComponentAssetPaths('header-container', basePath);
    initHeaderTooltips();
  });

  loadComponent('footer-container', `${basePath}components/footer.html`, () => {
    fixComponentAssetPaths('footer-container', basePath);
  });
}

initComponents();

function getProjectBasePath() {
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  const viewsIndex = pathSegments.indexOf('views');

  if (viewsIndex === -1) return './';

  const directoryDepth = pathSegments.length - viewsIndex - 1;
  return '../'.repeat(directoryDepth);
}

function fixComponentAssetPaths(containerId, basePath) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const elements = container.querySelectorAll('[href], [src]');

  elements.forEach(element => {
    const href = element.getAttribute('href');
    const src = element.getAttribute('src');

    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
      element.setAttribute('href', `${basePath}${href.replace(/^\.\//, '')}`);
    }

    if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('/')) {
      element.setAttribute('src', `${basePath}${src.replace(/^\.\//, '')}`);
    }
  });
}

/**
 * Carga un componente HTML mediante Fetch API y lo inyecta en el contenedor destino
 * @param {string} containerId - ID del contenedor en el DOM
 * @param {string} componentPath - Ruta relativa al archivo HTML del componente
 * @param {Function} [callback] - Función a ejecutar tras la inserción exitosa
 */
function loadComponent(containerId, componentPath, callback) {
  const container = document.getElementById(containerId);
  if (!container) return;

  fetch(componentPath)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Error al cargar el componente: ${componentPath} (Status ${response.status})`);
      }
      return response.text();
    })
    .then(html => {
      const componentDocument = new DOMParser().parseFromString(html, 'text/html');
      container.innerHTML = componentDocument.body.innerHTML;
      if (typeof callback === 'function') {
        callback();
      }
    })
    .catch(error => {
      console.error(error);
      container.innerHTML = `<div class="alert alert-danger m-3" role="alert">Error al cargar componente. Por favor recarga la página.</div>`;
    });
}

/**
 * Inicializa los Tooltips de Bootstrap 5 para los íconos del Header
 */
function initHeaderTooltips() {
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggerList.forEach(tooltipTriggerEl => {
    new bootstrap.Tooltip(tooltipTriggerEl);
  });
}
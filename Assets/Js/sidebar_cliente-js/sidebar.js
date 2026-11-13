document.addEventListener("DOMContentLoaded", () => {
    const sidebarContainer = document.getElementById('sidebar-container');

    if (!sidebarContainer) return;

    // Cargar componente sidebar reutilizable mediante fetch
    fetch('../../components/sidebar_cliente/sidebar.html?v=4', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) throw new Error("Error al cargar el componente sidebar.");
            return response.text();
        })
        .then(html => {
            const componentDocument = new DOMParser().parseFromString(html, 'text/html');
            sidebarContainer.innerHTML = componentDocument.body.innerHTML;
            marcarOpcionActiva();
            cargarDatosCliente();
        })
        .catch(error => console.error("Error:", error));

    // Resaltar visualmente la opción activa según la URL actual
    function marcarOpcionActiva() {
        const currentPath = window.location.pathname.toLowerCase();
        
        const navVehiculos = document.getElementById('nav-vehiculos');
        const navReservas = document.getElementById('nav-reservas');

        if (navVehiculos) navVehiculos.classList.remove('active');
        if (navReservas) navReservas.classList.remove('active');

        if (currentPath.includes('reservas')) {
            if (navReservas) navReservas.classList.add('active');
        } else if (currentPath.includes('vehiculos') || currentPath.includes('detalle')) {
            if (navVehiculos) navVehiculos.classList.add('active');
        }
    }

    async function cargarDatosCliente() {
        const elNombre = document.getElementById('cliente-nombre-completo');
        const elAvatar = document.getElementById('cliente-avatar');
        const elEmail = document.getElementById('cliente-email');

        try {
            const response = await fetch('../../controllers/seguridad/sidebar.php', {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            });
            const perfil = await response.json();

            if (!response.ok) {
                throw new Error(`No se pudo cargar el perfil (${response.status}).`);
            }
            if (perfil.rol !== 'cliente') {
                throw new Error('La sesión no corresponde a un cliente.');
            }

            const datosNombre = [perfil.nombre, perfil.apellido]
                .filter(nombre => typeof nombre === 'string' && nombre.trim());
            const nombreCompleto = datosNombre.join(' ');
            const iniciales = datosNombre
                .map(nombre => nombre.trim().charAt(0))
                .join('')
                .toUpperCase();

            if (!nombreCompleto || typeof perfil.correo !== 'string' || !perfil.correo) {
                throw new Error('El perfil no contiene los datos necesarios.');
            }

            if (elNombre) elNombre.textContent = nombreCompleto;
            if (elAvatar) elAvatar.textContent = iniciales;
            if (elEmail) elEmail.textContent = perfil.correo;
        } catch (error) {
            console.error('Error al cargar el perfil del cliente:', error);
            if (elNombre) elNombre.textContent = 'Perfil no disponible';
            if (elAvatar) elAvatar.textContent = '--';
            if (elEmail) elEmail.textContent = 'Inicia sesión nuevamente';
        }
    }
});
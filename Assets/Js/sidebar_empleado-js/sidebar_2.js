document.addEventListener("DOMContentLoaded", () => {
    const sidebarContainer = document.getElementById('sidebar-container');

    if (!sidebarContainer) return;

    // Cargar componente sidebar2 reutilizable mediante fetch
    fetch('../../components/sidebar_empleado/siderbar_2.html?v=4', { cache: 'no-store' })
        .then(response => {
            if (!response.ok) throw new Error("Error al cargar el componente sidebar2.");
            return response.text();
        })
        .then(html => {
            const componentDocument = new DOMParser().parseFromString(html, 'text/html');
            sidebarContainer.innerHTML = componentDocument.body.innerHTML;
            marcarOpcionActiva();
            cargarDatosEmpleado();
        })
        .catch(error => console.error("Error:", error));

    // Resaltar visualmente la opción activa según la URL actual
    function marcarOpcionActiva() {
        const currentPath = window.location.pathname.toLowerCase();
        
        const navRegistro = document.getElementById('nav-registro-vehiculos');
        const navNuevo = document.getElementById('nav-nuevo-alquiler');
        const navDetalle = document.getElementById('nav-detalle-alquiler');

        if (navRegistro) navRegistro.classList.remove('active');
        if (navNuevo) navNuevo.classList.remove('active');
        if (navDetalle) navDetalle.classList.remove('active');

        if (currentPath.includes('detalle')) {
            if (navDetalle) navDetalle.classList.add('active');
        } else if (currentPath.includes('nueva') || currentPath.includes('alquileres')) {
            if (navNuevo) navNuevo.classList.add('active');
        } else if (currentPath.includes('registro') || currentPath.includes('vehiculos')) {
            if (navRegistro) navRegistro.classList.add('active');
        }
    }

    async function cargarDatosEmpleado() {
        const elNombre = document.getElementById('empleado-nombre-completo');
        const elAvatar = document.getElementById('empleado-avatar');
        const elEmail = document.getElementById('empleado-email');

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
            if (perfil.rol !== 'empleado') {
                throw new Error('La sesión no corresponde a un empleado.');
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
            console.error('Error al cargar el perfil del empleado:', error);
            if (elNombre) elNombre.textContent = 'Perfil no disponible';
            if (elAvatar) elAvatar.textContent = '--';
            if (elEmail) elEmail.textContent = 'Inicia sesión nuevamente';
        }
    }
});
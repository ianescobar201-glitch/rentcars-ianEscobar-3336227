document.addEventListener("DOMContentLoaded", () => {
    // 1. Lógica para Mostrar/Ocultar contraseña
    const togglePassword = document.getElementById("togglePassword");
    const passwordInput = document.getElementById("password");

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener("click", () => {
            // Alternar el tipo de input
            const type = passwordInput.getAttribute("type") === "password" ? "text" : "password";
            passwordInput.setAttribute("type", type);
            
            // Alternar el ícono de Bootstrap
            const icon = togglePassword.querySelector("i");
            icon.classList.toggle("bi-eye");
            icon.classList.toggle("bi-eye-slash");
        });
    }

    // 2. Envío al controlador y validación del formulario
    const loginForm = document.getElementById("loginForm");
    const loginMessage = document.getElementById("login-message");

    if (new URLSearchParams(window.location.search).get("registro") === "exitoso") {
        mostrarMensaje("Tu cuenta fue creada exitosamente. Ya puedes iniciar sesión.", "success");
    }

    const errores = {
        campos: "Por favor, completa todos los campos requeridos.",
        credenciales: "El correo o la contraseña son incorrectos.",
        inactivo: "Tu cuenta está inactiva. Contacta con soporte.",
        rol: "Tu cuenta no tiene un rol válido. Contacta con soporte.",
        servidor: "No fue posible iniciar sesión. Inténtalo de nuevo más tarde."
    };
    const mensajeError = (codigo) => Object.prototype.hasOwnProperty.call(errores, codigo)
        ? errores[codigo]
        : "No fue posible iniciar sesión. Inténtalo de nuevo.";
    const codigoError = new URLSearchParams(window.location.search).get("error");

    if (codigoError) {
        mostrarMensaje(mensajeError(codigoError), "danger");
    }

    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const email = document.getElementById("email").value.trim();
            const password = document.getElementById("password").value;

            if (email === "" || password.trim() === "") {
                mostrarMensaje("Por favor, completa todos los campos requeridos.", "danger");
                return;
            }

            if (password.length < 6) {
                mostrarMensaje("La contraseña debe tener al menos 6 caracteres.", "warning");
                return;
            }

            const submitButton = loginForm.querySelector('button[type="submit"]');
            submitButton.disabled = true;

            try {
                const response = await fetch("../../controllers/seguridad/login.php", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                    },
                    body: new URLSearchParams({ email, password }),
                    credentials: "same-origin"
                });

                if (response.redirected) {
                    const destino = new URL(response.url);

                    if (destino.origin !== window.location.origin) {
                        throw new Error("El servidor devolvió un destino no válido.");
                    }

                    const rutaLogin = new URL("../../views/seguridad/login.html", window.location.href);
                    if (destino.pathname === rutaLogin.pathname) {
                        mostrarMensaje(mensajeError(destino.searchParams.get("error") || ""), "danger");
                        submitButton.disabled = false;
                        return;
                    }

                    const rutasDestino = [
                        "../../views/vehiculos/detalle-vehiculo.html",
                        "../../views/vehiculos/catalogo.html",
                        "../../views/vehiculos/registro-vehiculos.html",
                        "../../views/empleado/index.html",
                        "../../views/admin/index.html"
                    ].map((ruta) => new URL(ruta, window.location.href).pathname);

                    if (rutasDestino.includes(destino.pathname)) {
                        window.location.assign(destino.href);
                        return;
                    }

                    mostrarMensaje("El servidor devolvió un destino inesperado.", "danger");
                    submitButton.disabled = false;
                    return;
                }

                mostrarMensaje("El servidor no pudo completar el inicio de sesión. Inténtalo más tarde.", "danger");
                submitButton.disabled = false;
            } catch (error) {
                console.error("Error al iniciar sesión:", error);
                mostrarMensaje("No fue posible conectar con el servidor. Inténtalo de nuevo.", "danger");
                submitButton.disabled = false;
            }
        });
    }

    // Función auxiliar para mostrar alertas de Bootstrap
    function mostrarMensaje(mensaje, tipo) {
        loginMessage.textContent = mensaje;
        loginMessage.className = `alert alert-${tipo} mt-3 mb-4 text-center`; // Asignar clases
        loginMessage.classList.remove("d-none"); // Mostrar elemento

        // Ocultar mensaje automáticamente después de 4 segundos
        setTimeout(() => {
            loginMessage.classList.add("d-none");
        }, 4000);
    }
});
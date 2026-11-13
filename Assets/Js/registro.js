document.addEventListener("DOMContentLoaded", () => {
    const formRegistro = document.getElementById("form-registro");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirm_password");
    const alertMismatch = document.getElementById("alert-password-mismatch");
    const registrationMessage = document.getElementById("registration-message");

    const registrationErrors = {
        datos: "Los datos enviados no son válidos. Verifica el formulario e inténtalo de nuevo.",
        campos: "Completa todos los campos para crear tu cuenta.",
        correo_invalido: "Ingresa un correo electrónico válido.",
        password: "La contraseña debe tener al menos 6 caracteres.",
        password_diferente: "Las contraseñas ingresadas no coinciden.",
        correo_existente: "Ya existe una cuenta registrada con ese correo electrónico.",
        registro: "No se pudo completar el registro. Inténtalo de nuevo más tarde."
    };

    const error = new URLSearchParams(window.location.search).get("error");
    if (error && registrationErrors[error]) {
        registrationMessage.textContent = registrationErrors[error];
        registrationMessage.classList.add("alert-danger");
        registrationMessage.classList.remove("d-none");
    }

    // 1. Funcionalidad para mostrar/ocultar contraseña
    document.querySelectorAll(".toggle-password").forEach(button => {
        button.addEventListener("click", () => {
            const targetId = button.getAttribute("data-target");
            const input = document.getElementById(targetId);
            const icon = button.querySelector("i");

            if (input.type === "password") {
                input.type = "text";
                icon.classList.replace("bi-eye", "bi-eye-slash");
            } else {
                input.type = "password";
                icon.classList.replace("bi-eye-slash", "bi-eye");
            }
        });
    });

    // 2. Validación de envío del formulario de registro
    if (formRegistro) {
        formRegistro.addEventListener("submit", event => {
            // Validar coincidencia de contraseñas
            if (passwordInput.value !== confirmPasswordInput.value) {
                event.preventDefault();
                alertMismatch.classList.remove("d-none");
                confirmPasswordInput.classList.add("is-invalid");
                confirmPasswordInput.focus();
                return;
            } else {
                alertMismatch.classList.add("d-none");
                confirmPasswordInput.classList.remove("is-invalid");
            }

            // Validar campos requeridos con Bootstrap
            if (!formRegistro.checkValidity()) {
                event.preventDefault();
                formRegistro.classList.add("was-validated");
                return;
            }

            formRegistro.classList.add("was-validated");
        });
    }
});
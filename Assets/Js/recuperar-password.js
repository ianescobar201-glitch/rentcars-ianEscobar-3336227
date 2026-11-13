document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-recuperar');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm_password');
    const emailSection = document.getElementById('email-section');
    const passwordSection = document.getElementById('password-section');
    const confirmPasswordSection = document.getElementById('confirm-password-section');
    const securityRequirements = document.getElementById('security-requirements');
    const description = document.getElementById('recovery-description');
    const submitButton = document.getElementById('submit-recovery');
    const restartButton = document.getElementById('restart-reset');
    const reqLength = document.getElementById('req-length');
    const reqIcon = document.getElementById('req-icon');
    const reqMatch = document.getElementById('req-match');
    const matchIcon = document.getElementById('match-icon');
    const alertFeedback = document.getElementById('alert-feedback');
    const alertIcon = document.getElementById('alert-icon');
    const alertMsg = document.getElementById('alert-msg');

    const hashParameters = new URLSearchParams(window.location.hash.slice(1));
    let resetToken = hashParameters.get('token') || '';

    if (resetToken !== '') {
        history.replaceState(null, document.title, window.location.pathname + window.location.search);
    }

    function showAlert(message, type) {
        alertFeedback.classList.remove('d-none', 'alert-danger', 'alert-success');
        alertIcon.classList.remove('bi-exclamation-circle-fill', 'bi-check-circle-fill');

        if (type === 'success') {
            alertFeedback.classList.add('alert-success');
            alertIcon.classList.add('bi-check-circle-fill');
        } else {
            alertFeedback.classList.add('alert-danger');
            alertIcon.classList.add('bi-exclamation-circle-fill');
        }

        alertMsg.textContent = message;
    }

    function setMode(resetMode, canRestart = false) {
        emailSection.hidden = resetMode;
        emailInput.disabled = resetMode;
        emailInput.required = !resetMode;

        passwordSection.hidden = !resetMode;
        passwordInput.disabled = !resetMode;
        passwordInput.required = resetMode;

        confirmPasswordSection.hidden = !resetMode;
        confirmPasswordInput.disabled = !resetMode;
        confirmPasswordInput.required = resetMode;

        securityRequirements.hidden = !resetMode;
        description.textContent = resetMode
            ? 'Define una nueva contraseña para recuperar el acceso a tu cuenta.'
            : 'Ingresa tu correo y define tu nueva clave de acceso para restablecer el acceso a tu cuenta.';
        submitButton.textContent = resetMode
            ? 'Cambiar contraseña'
            : 'Enviar enlace de recuperación';
        restartButton.classList.toggle('d-none', !canRestart);
        form.classList.remove('was-validated');
        alertFeedback.classList.add('d-none');
    }

    document.querySelectorAll('.toggle-password').forEach((button) => {
        button.addEventListener('click', () => {
            const target = document.getElementById(button.getAttribute('data-target'));
            const icon = button.querySelector('i');
            const showPassword = target.type === 'password';

            target.type = showPassword ? 'text' : 'password';
            icon.classList.toggle('bi-eye', !showPassword);
            icon.classList.toggle('bi-eye-slash', showPassword);
        });
    });

    function validatePasswordRules() {
        const password = passwordInput.value;
        const confirmation = confirmPasswordInput.value;

        if (Array.from(password).length >= 8) {
            reqLength.classList.replace('text-muted', 'text-success');
            reqIcon.classList.replace('bi-circle', 'bi-check-circle-fill');
            reqIcon.classList.replace('text-secondary', 'text-success');
        } else {
            reqLength.classList.replace('text-success', 'text-muted');
            reqIcon.classList.replace('bi-check-circle-fill', 'bi-circle');
            reqIcon.classList.replace('text-success', 'text-secondary');
        }

        if (confirmation.length > 0 && password === confirmation) {
            reqMatch.classList.replace('text-muted', 'text-success');
            matchIcon.classList.replace('bi-circle', 'bi-check-circle-fill');
            matchIcon.classList.replace('text-secondary', 'text-success');
        } else {
            reqMatch.classList.replace('text-success', 'text-muted');
            matchIcon.classList.replace('bi-check-circle-fill', 'bi-circle');
            matchIcon.classList.replace('text-success', 'text-secondary');
        }
    }

    passwordInput.addEventListener('input', validatePasswordRules);
    confirmPasswordInput.addEventListener('input', validatePasswordRules);

    restartButton.addEventListener('click', () => {
        resetToken = '';
        passwordInput.value = '';
        confirmPasswordInput.value = '';
        setMode(false);
    });

    setMode(false);
    if (resetToken !== '') {
        form.hidden = true;
        fetch(form.action, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                accion: 'validar',
                token: resetToken
            }),
            credentials: 'same-origin',
            cache: 'no-store'
        })
            .then(async (response) => {
                const resultado = await response.json();
                form.hidden = false;

                if (!response.ok || !resultado.ok) {
                    resetToken = '';
                    setMode(false, true);
                    showAlert(
                        resultado.mensaje || 'El enlace no es válido o ya venció. Solicita uno nuevo.',
                        'danger'
                    );
                    return;
                }

                setMode(true);
            })
            .catch((error) => {
                console.error('Error al validar el enlace de recuperación:', error);
                resetToken = '';
                form.hidden = false;
                setMode(false, true);
                showAlert('No fue posible validar el enlace. Inténtalo de nuevo más tarde.', 'danger');
            });
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        form.classList.add('was-validated');

        if (resetToken === '') {
            if (!emailInput.checkValidity()) {
                showAlert('Ingresa un correo electrónico válido.', 'danger');
                return;
            }
        } else {
            const passwordBytes = new TextEncoder().encode(passwordInput.value).length;

            if (Array.from(passwordInput.value).length < 8 || passwordBytes > 72) {
                showAlert('La contraseña debe tener al menos 8 caracteres y no superar 72 bytes.', 'danger');
                return;
            }

            if (passwordInput.value !== confirmPasswordInput.value) {
                showAlert('Las contraseñas no coinciden.', 'danger');
                return;
            }
        }

        submitButton.disabled = true;

        const datos = resetToken === ''
            ? {
                accion: 'solicitar',
                correo: emailInput.value.trim()
            }
            : {
                accion: 'restablecer',
                token: resetToken,
                password: passwordInput.value,
                confirm_password: confirmPasswordInput.value
            };

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Accept': 'application/json'
                },
                body: new URLSearchParams(datos),
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const resultado = await response.json();

            if (!response.ok || !resultado.ok) {
                showAlert(
                    resultado.mensaje || 'No fue posible completar la solicitud. Inténtalo más tarde.',
                    'danger'
                );
                if (resetToken !== '') {
                    restartButton.classList.remove('d-none');
                }
                return;
            }

            if (datos.accion === 'restablecer') {
                resetToken = '';
                passwordInput.value = '';
                confirmPasswordInput.value = '';
                setMode(false);
            }

            showAlert(resultado.mensaje, 'success');
        } catch (error) {
            console.error('Error en recuperación de contraseña:', error);
            showAlert('No fue posible conectar con el servidor. Inténtalo de nuevo.', 'danger');
        } finally {
            submitButton.disabled = false;
        }
    });
});

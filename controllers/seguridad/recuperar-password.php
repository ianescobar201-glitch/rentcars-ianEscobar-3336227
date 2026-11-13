<?php

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// Envía una respuesta JSON y detiene el controlador para no procesar otra acción.
function responderJson(array $respuesta, int $estado = 200): void
{
    http_response_code($estado);
    echo json_encode($respuesta, JSON_UNESCAPED_UNICODE);
    exit;
}

// Valida la configuración SMTP y envía al usuario un enlace temporal de recuperación.
// Recibe el correo destinatario y el token original, que solo se incluye en el enlace.
function enviarEnlaceRecuperacion(string $correo, string $token): void
{
    $autoload = __DIR__ . '/../../vendor/autoload.php';
    if (!is_file($autoload)) {
        throw new RuntimeException('No está instalado PHPMailer.');
    }

    require_once $autoload;

    if (!class_exists(\PHPMailer\PHPMailer\PHPMailer::class)) {
        throw new RuntimeException('PHPMailer no está disponible.');
    }

    // La configuración se obtiene del entorno de Apache, no del formulario.
    $variables = [
        'RENTCARS_BASE_URL',
        'RENTCARS_SMTP_HOST',
        'RENTCARS_SMTP_PORT',
        'RENTCARS_SMTP_ENCRYPTION',
        'RENTCARS_MAIL_FROM',
        'RENTCARS_MAIL_FROM_NAME'
    ];
    $configuracion = [];

    foreach ($variables as $variable) {
        $valor = getenv($variable);
        if ($valor === false || trim($valor) === '') {
            throw new RuntimeException('Falta configurar ' . $variable . '.');
        }
        $configuracion[$variable] = trim($valor);
    }

    // Aceptar solo una URL HTTP(S) base para evitar construir enlaces con destinos inesperados.
    $baseUrl = rtrim($configuracion['RENTCARS_BASE_URL'], '/');
    $partesUrl = parse_url($baseUrl);
    if (
        $partesUrl === false ||
        !in_array($partesUrl['scheme'] ?? '', ['http', 'https'], true) ||
        empty($partesUrl['host']) ||
        isset($partesUrl['user']) ||
        isset($partesUrl['pass']) ||
        isset($partesUrl['query']) ||
        isset($partesUrl['fragment'])
    ) {
        throw new RuntimeException('RENTCARS_BASE_URL no es válida.');
    }

    if (!filter_var($configuracion['RENTCARS_MAIL_FROM'], FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('RENTCARS_MAIL_FROM no es válido.');
    }

    $puerto = filter_var(
        $configuracion['RENTCARS_SMTP_PORT'],
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1, 'max_range' => 65535]]
    );
    if ($puerto === false) {
        throw new RuntimeException('RENTCARS_SMTP_PORT no es válido.');
    }

    $cifrado = strtolower($configuracion['RENTCARS_SMTP_ENCRYPTION']);
    if (!in_array($cifrado, ['tls', 'ssl', 'none'], true)) {
        throw new RuntimeException('RENTCARS_SMTP_ENCRYPTION debe ser tls, ssl o none.');
    }

    // La autenticación es opcional solo para SMTP local sin cifrado (por ejemplo, Mailpit).
    $usuarioSmtp = getenv('RENTCARS_SMTP_USER');
    $passwordSmtp = getenv('RENTCARS_SMTP_PASSWORD');
    $usuarioSmtp = $usuarioSmtp === false ? '' : $usuarioSmtp;
    $passwordSmtp = $passwordSmtp === false ? '' : $passwordSmtp;
    if (($usuarioSmtp === '') !== ($passwordSmtp === '')) {
        throw new RuntimeException('La autenticación SMTP requiere usuario y contraseña.');
    }

    $autenticacionSmtp = $usuarioSmtp !== '';
    if ($cifrado === 'none') {
        $hostLocal = strtolower($configuracion['RENTCARS_SMTP_HOST']);
        if (!in_array($hostLocal, ['localhost', '127.0.0.1', '::1'], true)) {
            throw new RuntimeException('SMTP sin cifrado solo se permite para un servidor local.');
        }
    } elseif (!$autenticacionSmtp) {
        throw new RuntimeException('La configuración SMTP segura requiere autenticación.');
    }

    // El fragmento no se envía en la solicitud HTTP inicial al servidor web.
    $enlace = $baseUrl
        . '/views/seguridad/recuperar-password.html#token='
        . rawurlencode($token);

    try {
        $mailer = new \PHPMailer\PHPMailer\PHPMailer(true);
        $mailer->isSMTP();
        $mailer->Host = $configuracion['RENTCARS_SMTP_HOST'];
        $mailer->SMTPAuth = $autenticacionSmtp;
        if ($autenticacionSmtp) {
            $mailer->Username = $usuarioSmtp;
            $mailer->Password = $passwordSmtp;
        }
        $mailer->Port = $puerto;
        $mailer->SMTPSecure = $cifrado === 'ssl'
            ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS
            : ($cifrado === 'tls'
                ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS
                : '');
        $mailer->SMTPAutoTLS = $cifrado !== 'none';
        // No habilitar depuración SMTP: podría exponer datos técnicos o credenciales.
        $mailer->Timeout = 10;
        $mailer->SMTPDebug = 0;
        $mailer->CharSet = 'UTF-8';
        $mailer->setFrom(
            $configuracion['RENTCARS_MAIL_FROM'],
            $configuracion['RENTCARS_MAIL_FROM_NAME']
        );
        $mailer->addAddress($correo);
        $mailer->isHTML(true);
        $mailer->Subject = 'Recuperación de contraseña de RentCars';
        $enlaceHtml = htmlspecialchars($enlace, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $mailer->Body = '<p>Solicitaste restablecer la contraseña de tu cuenta.</p>'
            . '<p><a href="' . $enlaceHtml . '">Restablecer contraseña</a></p>'
            . '<p>El enlace vence en 30 minutos. Si no solicitaste este cambio, ignora este mensaje.</p>';
        $mailer->AltBody = "Solicitaste restablecer la contraseña de tu cuenta.\n"
            . "Abre este enlace dentro de los próximos 30 minutos:\n"
            . $enlace
            . "\nSi no solicitaste este cambio, ignora este mensaje.";

        if (!$mailer->send()) {
            throw new RuntimeException('El servidor SMTP no aceptó el mensaje.');
        }
    } catch (\Throwable $e) {
        throw new RuntimeException('PHPMailer no pudo enviar el mensaje.', 0, $e);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    responderJson(['ok' => false, 'mensaje' => 'Método no permitido.'], 405);
}

// La acción selecciona qué operación del flujo de recuperación se ejecutará.
$accion = $_POST['accion'] ?? '';
if (!is_string($accion)) {
    responderJson(['ok' => false, 'mensaje' => 'Solicitud inválida.'], 400);
}

try {
    // Reutiliza la conexión PDO existente del proyecto.
    require_once __DIR__ . '/../../config/database.php';

    if ($accion === 'solicitar') {
        // Validar el correo antes de consultar la base de datos.
        $correo = $_POST['correo'] ?? '';
        if (!is_string($correo)) {
            responderJson(['ok' => false, 'mensaje' => 'Correo inválido.'], 400);
        }

        $correo = trim($correo);
        if (!filter_var($correo, FILTER_VALIDATE_EMAIL)) {
            responderJson(['ok' => false, 'mensaje' => 'Ingresa un correo válido.'], 400);
        }

        // Mantener la misma respuesta para evitar revelar si una cuenta está registrada.
        $respuestaGenerica = [
            'ok' => true,
            'mensaje' => 'Si el correo está registrado y el servicio de correo está disponible, recibirás un enlace de recuperación.'
        ];

        $consulta = $conexion->prepare(
            'SELECT id_usuario FROM usuarios WHERE correo = :correo LIMIT 1'
        );
        $consulta->execute([':correo' => $correo]);
        $usuario = $consulta->fetch(PDO::FETCH_ASSOC);

        if (!$usuario) {
            responderJson($respuestaGenerica);
        }

        // random_bytes produce 32 bytes impredecibles; solo su hash se persiste.
        $token = '';
        try {
            $token = bin2hex(random_bytes(32));
        } catch (Exception $e) {
            error_log('No se pudo generar el token de recuperación en RentCars: ' . $e->getMessage());
            responderJson([
                'ok' => false,
                'mensaje' => 'No fue posible completar la solicitud. Inténtalo más tarde.'
            ], 500);
        }
        $tokenHash = hash('sha256', $token);

        // Reemplazar cualquier token anterior e iniciar una vigencia de 30 minutos.
        $guardarToken = $conexion->prepare(
            'UPDATE usuarios
             SET reset_token_hash = :token_hash,
                 reset_expires_at = DATE_ADD(NOW(), INTERVAL 30 MINUTE)
             WHERE id_usuario = :id_usuario'
        );
        $guardarToken->execute([
            ':token_hash' => $tokenHash,
            ':id_usuario' => $usuario['id_usuario']
        ]);

        try {
            enviarEnlaceRecuperacion($correo, $token);
        } catch (RuntimeException $e) {
            error_log(
                'Error de correo en recuperación de contraseña RentCars: '
                    . $e->getMessage()
                    . ($e->getPrevious() ? ' ' . $e->getPrevious()->getMessage() : '')
            );

            // Si el correo falla, limpiar únicamente este token pendiente.
            $invalidarToken = $conexion->prepare(
                'UPDATE usuarios
                 SET reset_token_hash = NULL, reset_expires_at = NULL
                 WHERE id_usuario = :id_usuario AND reset_token_hash = :token_hash'
            );
            $invalidarToken->execute([
                ':id_usuario' => $usuario['id_usuario'],
                ':token_hash' => $tokenHash
            ]);
        }

        responderJson($respuestaGenerica);
    }

    if ($accion === 'validar') {
        // Esta comprobación permite no mostrar el formulario si el enlace ya se usó o venció.
        $token = $_POST['token'] ?? '';
        if (!is_string($token) || !preg_match('/\A[a-f0-9]{64}\z/', $token)) {
            responderJson([
                'ok' => false,
                'mensaje' => 'El enlace no es válido o ya venció. Solicita uno nuevo.'
            ], 400);
        }

        $consultaToken = $conexion->prepare(
            'SELECT 1
             FROM usuarios
             WHERE reset_token_hash = :token_hash
               AND reset_expires_at > NOW()
             LIMIT 1'
        );
        $consultaToken->execute([
            ':token_hash' => hash('sha256', $token)
        ]);

        if (!$consultaToken->fetchColumn()) {
            responderJson([
                'ok' => false,
                'mensaje' => 'El enlace no es válido o ya venció. Solicita uno nuevo.'
            ], 400);
        }

        responderJson([
            'ok' => true,
            'mensaje' => 'El enlace es válido.'
        ]);
    }

    if ($accion === 'restablecer') {
        // Recibir el token y las dos entradas de contraseña para validarlas en el servidor.
        $token = $_POST['token'] ?? '';
        $password = $_POST['password'] ?? '';
        $confirmacion = $_POST['confirm_password'] ?? '';

        if (
            !is_string($token) ||
            !is_string($password) ||
            !is_string($confirmacion)
        ) {
            responderJson(['ok' => false, 'mensaje' => 'Datos inválidos.'], 400);
        }

        if (!preg_match('/\A[a-f0-9]{64}\z/', $token)) {
            responderJson([
                'ok' => false,
                'mensaje' => 'El enlace no es válido o ya venció. Solicita uno nuevo.'
            ], 400);
        }

        // Validar caracteres Unicode y bytes para evitar límites/truncamiento de bcrypt.
        $caracteres = preg_match_all('/./us', $password);
        if (
            $caracteres === false ||
            $caracteres < 8 ||
            strlen($password) > 72 ||
            strpos($password, "\0") !== false
        ) {
            responderJson([
                'ok' => false,
                'mensaje' => 'La contraseña debe tener al menos 8 caracteres y no superar 72 bytes.'
            ], 400);
        }

        if ($password !== $confirmacion) {
            responderJson([
                'ok' => false,
                'mensaje' => 'Las contraseñas no coinciden.'
            ], 400);
        }

        // Nunca guardar la contraseña en texto plano.
        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        if ($passwordHash === false) {
            error_log('No se pudo generar el hash de contraseña en RentCars.');
            responderJson([
                'ok' => false,
                'mensaje' => 'No fue posible cambiar la contraseña. Inténtalo más tarde.'
            ], 500);
        }

        // Una sola actualización condicional cambia la clave y consume el token atómicamente.
        $consumirToken = $conexion->prepare(
            'UPDATE usuarios
             SET `password` = :password,
                 reset_token_hash = NULL,
                 reset_expires_at = NULL
             WHERE reset_token_hash = :token_hash
               AND reset_expires_at > NOW()'
        );
        $consumirToken->execute([
            ':password' => $passwordHash,
            ':token_hash' => hash('sha256', $token)
        ]);

        if ($consumirToken->rowCount() !== 1) {
            responderJson([
                'ok' => false,
                'mensaje' => 'El enlace no es válido o ya venció. Solicita uno nuevo.'
            ], 400);
        }

        responderJson([
            'ok' => true,
            'mensaje' => 'La contraseña se cambió correctamente. Ya puedes iniciar sesión.'
        ]);
    }

    responderJson(['ok' => false, 'mensaje' => 'Solicitud inválida.'], 400);
} catch (PDOException $e) {
    // Registrar detalles técnicos solo en el servidor; enviar un mensaje genérico al cliente.
    error_log('Error de base de datos en recuperación de contraseña RentCars: ' . $e->getMessage());
    responderJson([
        'ok' => false,
        'mensaje' => 'No fue posible completar la solicitud. Inténtalo más tarde.'
    ], 500);
} catch (RuntimeException $e) {
    // Errores de configuración o de envío no deben revelar datos internos al usuario.
    error_log('Error interno en recuperación de contraseña RentCars: ' . $e->getMessage());
    responderJson([
        'ok' => false,
        'mensaje' => 'No fue posible completar la solicitud. Inténtalo más tarde.'
    ], 500);
} catch (Throwable $e) {
    // Capturar fallos inesperados y mantener una respuesta sin detalles técnicos.
    error_log('Error inesperado en recuperación de contraseña RentCars: ' . $e->getMessage());
    responderJson([
        'ok' => false,
        'mensaje' => 'No fue posible completar la solicitud. Inténtalo más tarde.'
    ], 500);
}

//Ingresar el siguiente codigo en el archivo httpd.conf o .htaccess de tu servidor web
//Para tener acceso a correo de recuperacion de contraseña.

//SetEnv RENTCARS_BASE_URL "http://localhost/rentcars"
//SetEnv RENTCARS_SMTP_HOST "smtp.gmail.com"
//SetEnv RENTCARS_SMTP_PORT "587"
//SetEnv RENTCARS_SMTP_ENCRYPTION "tls"
//SetEnv RENTCARS_SMTP_USER "Ingresar correo de remitente"
//SetEnv RENTCARS_SMTP_PASSWORD "ingresar codigo de aplicacion"
//SetEnv RENTCARS_MAIL_FROM "ingresar correo de remitente"
//SetEnv RENTCARS_MAIL_FROM_NAME "RentCars"
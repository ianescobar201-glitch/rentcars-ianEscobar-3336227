<?php

// Iniciar la sesión.
session_start();

// Evitar que la respuesta sea almacenada en caché.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// Verificar que la solicitud sea POST.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: ../../views/seguridad/login.html');
    exit;
}

// Recibir los datos del formulario.
$correo = $_POST['email'] ?? '';
// El formulario envía la contraseña con el campo POST "password".
$contrasena = $_POST['password'] ?? '';

// Validar que ambos valores recibidos sean texto antes de procesarlos.
if (
    !is_string($correo) ||
    !is_string($contrasena)
) {
    header('Location: ../../views/seguridad/login.html?error=campos');
    exit;
}

// Quitar espacios externos del correo; no modificar la contraseña.
$correo = trim($correo);

// Validar que ambos campos estén presentes.
if ($correo === '' || $contrasena === '') {
    header('Location: ../../views/seguridad/login.html?error=campos');
    exit;
}

// Validar el formato del correo.
if (!filter_var($correo, FILTER_VALIDATE_EMAIL)) {
    header('Location: ../../views/seguridad/login.html?error=credenciales');
    exit;
}

try {

    // Importar la conexión existente.
    require_once __DIR__ . '/../../config/database.php';

    // Buscar el usuario por su correo electrónico.
    $consulta = $conexion->prepare(
        "SELECT id_usuario, nombre, apellido, correo, `password`, rol, estado
         FROM usuarios
         WHERE correo = :correo
         LIMIT 1"
    );

    $consulta->execute([
        ':correo' => $correo
    ]);

    // Obtener los datos del usuario.
    $usuario = $consulta->fetch(PDO::FETCH_ASSOC);

    // Comparar el campo POST con el hash guardado en usuarios.password.
    if (
        !$usuario ||
        !password_verify($contrasena, $usuario['password'])
    ) {
        header('Location: ../../views/seguridad/login.html?error=credenciales');
        exit;
    }

    // Comprobar que la cuenta esté activa.
    if ((int) $usuario['estado'] !== 1) {
        header('Location: ../../views/seguridad/login.html?error=inactivo');
        exit;
    }

    // Regenerar el identificador de sesión.
    session_regenerate_id(true);

    // Guardar la información básica del usuario autenticado.
    $_SESSION['usuario'] = [
        'id_usuario' => $usuario['id_usuario'],
        'nombre' => $usuario['nombre'],
        'rol' => $usuario['rol']
    ];

    // Redirigir según el rol obtenido desde la base de datos.
    switch ($usuario['rol']) {

        case 'cliente':
            header('Location: ../../views/vehiculos/detalle-vehiculo.html');
            break;

        case 'empleado':
            header('Location: ../../views/vehiculos/registro-vehiculos.html');
            break;

        case 'administrador':
            header('Location: ../../views/admin/index.html');
            break;

        default:
            // Si el rol no está reconocido, cerrar la sesión.
            $_SESSION = [];
            session_destroy();

            header('Location: ../../views/seguridad/login.html?error=rol');
            break;
    }

    exit;
} catch (PDOException $e) {

    // Guardar el error técnico en el registro interno.
    error_log('Error de autenticación RentCars: ' . $e->getMessage());

    // Mostrar un mensaje genérico al usuario.
    header('Location: ../../views/seguridad/login.html?error=servidor');
    exit;
}

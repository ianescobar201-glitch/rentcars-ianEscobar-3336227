<?php

// Este endpoint entrega los datos del usuario autenticado al sidebar.
// No inicia sesión ni autentica credenciales: reutiliza la sesión creada por login.php.
session_start();

// El perfil es información de sesión y no debe guardarse en cachés del navegador o proxy.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// El JavaScript del sidebar consulta este recurso mediante GET.
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

// La sesión conserva el ID; el nombre y el correo se vuelven a leer de la base de datos.
$usuarioSesion = $_SESSION['usuario'] ?? null;

if (
    !is_array($usuarioSesion) ||
    !isset($usuarioSesion['id_usuario']) ||
    (!is_int($usuarioSesion['id_usuario']) && !is_string($usuarioSesion['id_usuario']))
) {
    http_response_code(401);
    echo json_encode(['error' => 'authentication_required']);
    exit;
}

try {
    // Obtener datos actuales del usuario; la consulta preparada evita concatenar el ID en SQL.
    require_once __DIR__ . '/../../config/database.php';

    $consulta = $conexion->prepare(
        'SELECT nombre, apellido, correo, rol, estado
         FROM usuarios
         WHERE id_usuario = :id_usuario
         LIMIT 1'
    );
    $consulta->execute([
        ':id_usuario' => $usuarioSesion['id_usuario']
    ]);
    $usuario = $consulta->fetch(PDO::FETCH_ASSOC);

    // Si la cuenta ya no existe o fue desactivada, invalidar la sesión y pedir autenticación.
    if (!$usuario || (int) $usuario['estado'] !== 1) {
        $_SESSION = [];
        session_destroy();
        http_response_code(401);
        echo json_encode(['error' => 'authentication_required']);
        exit;
    }

    // Este componente solo está disponible para los sidebars de cliente y empleado.
    if (!in_array($usuario['rol'], ['cliente', 'empleado'], true)) {
        http_response_code(403);
        echo json_encode(['error' => 'sidebar_unavailable']);
        exit;
    }

    // Solo se exponen los campos que necesita el sidebar; nunca se envía la contraseña.
    echo json_encode([
        'nombre' => $usuario['nombre'],
        'apellido' => $usuario['apellido'],
        'correo' => $usuario['correo'],
        'rol' => $usuario['rol']
    ], JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    // El detalle técnico queda en el registro del servidor, no en la respuesta al navegador.
    error_log('Error al cargar perfil del sidebar RentCars: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'profile_unavailable']);
}
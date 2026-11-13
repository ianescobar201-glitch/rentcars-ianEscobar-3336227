<?php

declare(strict_types=1);

session_start();

// Este endpoint entrega JSON y evita que el catálogo quede guardado en caché.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

function responderCatalogo(array $datos, int $estadoHttp = 200): void
{
    http_response_code($estadoHttp);
    echo json_encode(
        $datos,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

// Sólo expone rutas de fotos creadas por el registro de vehículos, no rutas arbitrarias de la base de datos.
function rutaFotoCatalogo(?string $nombreGuardado): string
{
    if (!is_string($nombreGuardado) || $nombreGuardado === '') {
        return '';
    }

    $prefijo = 'Assets/Images/';

    if (strncmp($nombreGuardado, $prefijo, strlen($prefijo)) === 0) {
        $nombreGuardado = substr($nombreGuardado, strlen($prefijo));
    }

    if (!preg_match('/\A[a-f0-9]{32}\.(?:jpg|png|webp)\z/', $nombreGuardado)) {
        return '';
    }

    return '../../Assets/Images/' . $nombreGuardado;
}

try {
    // El catálogo es de consulta; rechaza métodos y acciones distintos de la operación de listado.
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        header('Allow: GET');
        responderCatalogo(
            ['ok' => false, 'mensaje' => 'Método no permitido.'],
            405
        );
    }

    if (($_GET['action'] ?? '') !== 'list') {
        responderCatalogo(
            ['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'],
            400
        );
    }

    $usuarioSesion = $_SESSION['usuario'] ?? null;

    // Valida el identificador de sesión antes de consultar el rol vigente en MySQL.
    if (
        !is_array($usuarioSesion) ||
        !isset($usuarioSesion['id_usuario']) ||
        (!is_int($usuarioSesion['id_usuario']) && !is_string($usuarioSesion['id_usuario'])) ||
        !ctype_digit((string) $usuarioSesion['id_usuario'])
    ) {
        responderCatalogo(
            ['ok' => false, 'mensaje' => 'Inicia sesión para consultar el catálogo.'],
            401
        );
    }

    require_once __DIR__ . '/../../config/database.php';
    define('RENTCARS_ALQUILER_HELPERS_ONLY', true);
    require_once __DIR__ . '/../alquileres/nuevo.php';

    if (!isset($conexion) || !($conexion instanceof PDO)) {
        responderCatalogo(
            ['ok' => false, 'mensaje' => 'No fue posible cargar el catálogo. Inténtalo de nuevo.'],
            500
        );
        return;
    }

    $consultaUsuario = $conexion->prepare(
        'SELECT rol, estado
         FROM usuarios
         WHERE id_usuario = :id_usuario
         LIMIT 1'
    );
    $consultaUsuario->bindValue(
        ':id_usuario',
        (string) $usuarioSesion['id_usuario'],
        PDO::PARAM_STR
    );
    $consultaUsuario->execute();
    $usuario = $consultaUsuario->fetch(PDO::FETCH_ASSOC);

    // Una cuenta inexistente o desactivada no debe conservar acceso por una sesión previa.
    if (!$usuario || (int) $usuario['estado'] !== 1) {
        $_SESSION = [];
        session_destroy();
        responderCatalogo(
            ['ok' => false, 'mensaje' => 'La sesión ya no está activa.'],
            401
        );
    }

    if ($usuario['rol'] !== 'cliente') {
        responderCatalogo(
            ['ok' => false, 'mensaje' => 'No tienes permiso para consultar este catálogo.'],
            403
        );
    }

    // Sincroniza vencimientos antes de calcular la disponibilidad del catálogo.
    $conexion->beginTransaction();
    sincronizarAlquileresVencidos(
        $conexion,
        new DateTimeImmutable('now', new DateTimeZone('America/Bogota'))
    );
    $conexion->commit();

    $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
    $consultaReservaActivaUsuario = $conexion->prepare(
        'SELECT 1
         FROM alquileres
         WHERE id_usuario = :id_usuario
           AND estado IN (0, 2)
           AND fecha_devolucion_programada > :ahora
         LIMIT 1'
    );
    $consultaReservaActivaUsuario->execute([
        ':id_usuario' => $usuarioSesion['id_usuario'],
        ':ahora' => $ahora->format('Y-m-d H:i:s')
    ]);
    $usuarioTieneReservaActiva = $consultaReservaActivaUsuario->fetchColumn() !== false;

    // Sólo se ofrecen categorías activas y vehículos no retirados; los estados como mantenimiento
    // se incluyen para que el cliente pueda consultar el vehículo y ver que no está disponible.
    $categorias = $conexion->query(
        'SELECT id_categoria, nombre
         FROM categorias_vehiculo
         WHERE estado = 1
         ORDER BY nombre'
    )->fetchAll(PDO::FETCH_ASSOC);

    $consultaVehiculos = $conexion->prepare(
        'SELECT v.id_vehiculo, v.marca, v.modelo, v.`año` AS anio,
                v.color, v.combustible, v.`transmisión` AS transmision,
                v.capacidad, v.kilometraje_actual AS kilometraje,
                v.estado_vehiculo AS estado, v.foto_vehiculo, v.id_categoria,
                EXISTS (
                    SELECT 1
                    FROM alquileres AS a
                    WHERE a.id_vehiculo = v.id_vehiculo
                      AND a.estado IN (0, 2)
                      AND a.fecha_devolucion_programada > :ahora
                ) AS reserva_pendiente_activa
         FROM vehiculos AS v
         INNER JOIN categorias_vehiculo AS c
             ON c.id_categoria = v.id_categoria
         WHERE COALESCE(v.estado_vehiculo, \'\') <> \'Inactivo\'
           AND c.estado = 1
         ORDER BY v.id_vehiculo DESC'
    );
    $consultaVehiculos->execute([
        ':ahora' => $ahora->format('Y-m-d H:i:s')
    ]);

    $categorias = array_map(
        static function (array $categoria): array {
            return [
                'id_categoria' => (string) $categoria['id_categoria'],
                'nombre' => $categoria['nombre']
            ];
        },
        $categorias
    );

    $vehiculos = array_map(
        static function (array $vehiculo): array {
            // Normaliza los nombres de campos que consume el JavaScript del catálogo.
            return [
                'id_vehiculo' => (string) $vehiculo['id_vehiculo'],
                'marca' => $vehiculo['marca'] ?? '',
                'modelo' => $vehiculo['modelo'] ?? '',
                'anio' => $vehiculo['anio'] ?? '',
                'color' => $vehiculo['color'] ?? '',
                'combustible' => $vehiculo['combustible'] ?? '',
                'transmision' => $vehiculo['transmision'] ?? '',
                'capacidad' => $vehiculo['capacidad'] ?? '',
                'kilometraje' => $vehiculo['kilometraje'] ?? '',
                'estado' => $vehiculo['estado'] ?? '',
                'reserva_pendiente_activa' => (int) $vehiculo['reserva_pendiente_activa'],
                'foto' => rutaFotoCatalogo($vehiculo['foto_vehiculo'] ?? null),
                'id_categoria' => (string) $vehiculo['id_categoria']
            ];
        },
        $consultaVehiculos->fetchAll(PDO::FETCH_ASSOC)
    );

    responderCatalogo([
        'ok' => true,
        'categorias' => $categorias,
        'vehiculos' => $vehiculos,
        'usuario_tiene_reserva_activa' => $usuarioTieneReservaActiva
    ]);
} catch (PDOException $error) {
    if (isset($conexion) && $conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }

    // El detalle de la excepción se registra en el servidor; el cliente recibe un mensaje genérico.
    error_log('Error al cargar el catálogo de vehículos RentCars: ' . $error->getMessage());
    responderCatalogo(
        ['ok' => false, 'mensaje' => 'No fue posible cargar el catálogo. Inténtalo de nuevo.'],
        500
    );
} catch (Throwable $error) {
    if (isset($conexion) && $conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }

    error_log('Error inesperado en el catálogo de vehículos RentCars: ' . $error->getMessage());
    responderCatalogo(
        ['ok' => false, 'mensaje' => 'Ocurrió un error interno al cargar el catálogo.'],
        500
    );
}

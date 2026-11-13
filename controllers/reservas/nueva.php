<?php

declare(strict_types=1);

session_start();

// Este controlador responde JSON: el JavaScript de nueva.html lo usa para
// cargar el vehículo y el historial, crear solicitudes y gestionar cancelaciones.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// Excepción para devolver errores esperados de validación con su código HTTP,
// sin confundirlos con fallos inesperados de PHP o de la base de datos.
final class ReservaApiException extends RuntimeException
{
    public int $httpStatus;

    public function __construct(string $message, int $httpStatus)
    {
        parent::__construct($message);
        $this->httpStatus = $httpStatus;
    }
}

function responderReserva(array $respuesta, int $estadoHttp = 200): void
{
    http_response_code($estadoHttp);
    // Las respuestas JSON permiten que el frontend informe éxito o error al cliente.
    echo json_encode(
        $respuesta,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function leerCampoReserva(array $origen, string $campo): string
{
    $valor = $origen[$campo] ?? '';

    if (!is_string($valor)) {
        throw new ReservaApiException('La solicitud contiene un campo inválido.', 400);
    }

    return trim($valor);
}

function validarIdReserva(string $id): bool
{
    // Sólo admite identificadores enteros positivos antes de usarlos en consultas.
    return ctype_digit($id) && (int) $id > 0;
}

function validarFechaReserva(string $valor): ?DateTimeImmutable
{
    // El formulario envía datetime-local como YYYY-MM-DDTHH:mm;
    // se valida formato y fecha real usando la zona horaria del proyecto.
    if (!preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\z/', $valor)) {
        return null;
    }

    $zonaHoraria = new DateTimeZone('America/Bogota');
    $fecha = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i', $valor, $zonaHoraria);
    $errores = DateTimeImmutable::getLastErrors();

    if (
        $fecha === false ||
        ($errores !== false && ($errores['warning_count'] > 0 || $errores['error_count'] > 0)) ||
        $fecha->format('Y-m-d\TH:i') !== $valor
    ) {
        return null;
    }

    return $fecha;
}

function rutaFotoReserva(?string $fotoGuardada): string
{
    if (!is_string($fotoGuardada) || $fotoGuardada === '') {
        return '';
    }

    $prefijo = 'Assets/Images/';

    if (str_starts_with($fotoGuardada, $prefijo)) {
        $fotoGuardada = substr($fotoGuardada, strlen($prefijo));
    }

    // Se aceptan sólo nombres generados por el sistema y extensiones permitidas;
    // no se expone una ruta arbitraria almacenada en la base de datos.
    if (!preg_match('/\A[a-f0-9]{32}\.(?:jpg|png|webp)\z/', $fotoGuardada)) {
        return '';
    }

    return '../../Assets/Images/' . $fotoGuardada;
}

function mapearEstadoReserva(int $estado): string
{
    // Los códigos numéricos de alquileres se convierten en etiquetas para el frontend.
    return match ($estado) {
        0 => 'Pendiente',
        1 => 'Cancelada',
        2 => 'Convertida en alquiler',
        3 => 'Alquiler cancelado',
        4 => 'Completado',
        default => 'No disponible'
    };
}

/** @var PDO|null $conexion */
$conexion = null;

try {
    $metodo = $_SERVER['REQUEST_METHOD'] ?? '';

    // GET se reserva para consultar información; POST modifica reservas.
    if (!in_array($metodo, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        responderReserva(['ok' => false, 'mensaje' => 'Método no permitido.'], 405);
    }

    $usuarioSesion = $_SESSION['usuario'] ?? null;

    // El identificador de sesión se valida antes de consultar cualquier dato privado.
    if (
        !is_array($usuarioSesion) ||
        !isset($usuarioSesion['id_usuario']) ||
        (!is_int($usuarioSesion['id_usuario']) && !is_string($usuarioSesion['id_usuario'])) ||
        !ctype_digit((string) $usuarioSesion['id_usuario'])
    ) {
        responderReserva(['ok' => false, 'mensaje' => 'Inicia sesión para continuar.'], 401);
    }

    // Reutiliza la conexión PDO compartida por el proyecto.
    require_once __DIR__ . '/../../config/database.php';
    if (!($conexion instanceof PDO)) {
        throw new RuntimeException('La conexión de base de datos no fue inicializada.');
    }

    define('RENTCARS_ALQUILER_HELPERS_ONLY', true);
    require_once __DIR__ . '/../alquileres/nuevo.php';

    if (!($conexion instanceof PDO)) {
        throw new RuntimeException('La conexión de base de datos no fue inicializada.');
    }

    $consultaUsuario = $conexion->prepare(
        'SELECT rol, estado
         FROM usuarios
         WHERE id_usuario = :id_usuario
         LIMIT 1'
    );
    $consultaUsuario->execute([
        ':id_usuario' => $usuarioSesion['id_usuario']
    ]);
    $usuario = $consultaUsuario->fetch(PDO::FETCH_ASSOC);

    // Se vuelve a verificar en la base de datos que la cuenta siga activa y tenga
    // el rol cliente; no basta con confiar en los datos antiguos de la sesión.
    if (!$usuario || (int) $usuario['estado'] !== 1) {
        $_SESSION = [];
        session_destroy();
        responderReserva(['ok' => false, 'mensaje' => 'La sesión ya no está activa.'], 401);
    }

    if ($usuario['rol'] !== 'cliente') {
        responderReserva(['ok' => false, 'mensaje' => 'Solo un cliente puede gestionar sus reservas.'], 403);
    }

    if ($metodo === 'GET') {
        if (($_GET['action'] ?? '') !== 'init') {
            responderReserva(['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'], 400);
        }

        // El token se entrega al formulario y luego protege sus operaciones POST.
        if (!isset($_SESSION['csrf_reservas'])) {
            $_SESSION['csrf_reservas'] = bin2hex(random_bytes(32));
        }

        // Completa alquileres vencidos antes de validar disponibilidad e historial del cliente.
        $conexion->beginTransaction();
        sincronizarAlquileresVencidos(
            $conexion,
            new DateTimeImmutable('now', new DateTimeZone('America/Bogota'))
        );
        $conexion->commit();

        $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
        $consultaReservaActivaUsuario = $conexion->prepare(
            'SELECT id_alquiler
             FROM alquileres
             WHERE id_usuario = :id_usuario
               AND estado IN (0, 2)
               AND fecha_devolucion_programada > :ahora
             ORDER BY fecha_devolucion_programada DESC
             LIMIT 1'
        );
        $consultaReservaActivaUsuario->execute([
            ':id_usuario' => $usuarioSesion['id_usuario'],
            ':ahora' => $ahora->format('Y-m-d H:i:s')
        ]);
        $reservaActivaUsuario = $consultaReservaActivaUsuario->fetchColumn() !== false;

        // El catálogo envía el ID en la URL. Si falta, se carga igualmente
        // el historial del cliente y el frontend muestra que no hay selección.
        $vehiculo = null;
        $idVehiculo = $_GET['id'] ?? $_GET['id_vehiculo'] ?? '';

        if ($idVehiculo !== '') {
            if (!is_string($idVehiculo) || !validarIdReserva($idVehiculo)) {
                responderReserva(['ok' => false, 'mensaje' => 'El vehículo seleccionado no es válido.'], 422);
            }

            $consultaVehiculo = $conexion->prepare(
                'SELECT v.id_vehiculo, v.marca, v.modelo, v.`año` AS anio,
                        v.estado_vehiculo AS estado, v.foto_vehiculo, v.id_categoria,
                        c.nombre AS categoria,
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
                 WHERE v.id_vehiculo = :id_vehiculo
                   AND c.estado = 1
                   AND COALESCE(v.estado_vehiculo, \'\') <> \'Inactivo\'
                 LIMIT 1'
            );
            $consultaVehiculo->execute([
                ':id_vehiculo' => $idVehiculo,
                ':ahora' => $ahora->format('Y-m-d H:i:s')
            ]);
            $vehiculoEncontrado = $consultaVehiculo->fetch(PDO::FETCH_ASSOC);

            // Una solicitud no cancelada mantiene el vehículo ocupado para todos
            // hasta que se cancele o pase su hora de devolución.
            if ($vehiculoEncontrado) {
                $vehiculo = [
                    'id_vehiculo' => (string) $vehiculoEncontrado['id_vehiculo'],
                    'marca' => $vehiculoEncontrado['marca'] ?? '',
                    'modelo' => $vehiculoEncontrado['modelo'] ?? '',
                    'anio' => $vehiculoEncontrado['anio'] ?? '',
                    'estado' => $vehiculoEncontrado['estado'] ?? '',
                    'reserva_pendiente_activa' => (int) $vehiculoEncontrado['reserva_pendiente_activa'],
                    'usuario_tiene_reserva_activa' => $reservaActivaUsuario,
                    'foto' => rutaFotoReserva($vehiculoEncontrado['foto_vehiculo'] ?? null),
                    'id_categoria' => (string) $vehiculoEncontrado['id_categoria'],
                    'categoria' => $vehiculoEncontrado['categoria'] ?? 'Sin categoría'
                ];
            }
        }

        // El historial se filtra por el usuario autenticado para que cada cliente
        // sólo pueda consultar y gestionar sus propias solicitudes.
        $consultaHistorial = $conexion->prepare(
            'SELECT a.id_alquiler, a.id_vehiculo, a.fecha_entrega,
                    a.fecha_devolucion_programada, a.estado,
                    v.marca, v.modelo, c.nombre AS categoria
             FROM alquileres AS a
             LEFT JOIN vehiculos AS v ON v.id_vehiculo = a.id_vehiculo
             LEFT JOIN categorias_vehiculo AS c ON c.id_categoria = v.id_categoria
             WHERE a.id_usuario = :id_usuario
               AND a.estado IN (:pendiente, :cancelada, :convertida, :alquiler_cancelado, :completado)
             ORDER BY a.id_alquiler DESC'
        );
        $consultaHistorial->execute([
            ':id_usuario' => $usuarioSesion['id_usuario'],
            ':pendiente' => 0,
            ':cancelada' => 1,
            ':convertida' => 2,
            ':alquiler_cancelado' => 3,
            ':completado' => 4
        ]);

        $historial = array_map(
            static function (array $fila): array {
                return [
                    'id_reserva' => (string) $fila['id_alquiler'],
                    'id_vehiculo' => (string) $fila['id_vehiculo'],
                    'fecha_inicio' => $fila['fecha_entrega'],
                    'fecha_fin' => $fila['fecha_devolucion_programada'],
                    'estado' => mapearEstadoReserva((int) $fila['estado']),
                    'vehiculo_nombre' => trim(
                        (string) ($fila['marca'] ?? '') . ' ' . (string) ($fila['modelo'] ?? '')
                    ),
                    'vehiculo_categoria' => $fila['categoria'] ?? 'Sin categoría'
                ];
            },
            $consultaHistorial->fetchAll(PDO::FETCH_ASSOC)
        );

        responderReserva([
            'ok' => true,
            'csrf_token' => $_SESSION['csrf_reservas'],
            'vehiculo' => $vehiculo,
            'usuario_tiene_reserva_activa' => $reservaActivaUsuario,
            'reservas' => $historial
        ]);
    }

    // Todas las operaciones que modifican datos requieren el token asociado
    // a la sesión, como protección contra solicitudes falsificadas (CSRF).
    $token = leerCampoReserva($_POST, 'csrf_token');

    if (
        !isset($_SESSION['csrf_reservas']) ||
        !hash_equals($_SESSION['csrf_reservas'], $token)
    ) {
        responderReserva(['ok' => false, 'mensaje' => 'La solicitud venció. Actualiza la página e inténtalo de nuevo.'], 403);
    }

    $accion = leerCampoReserva($_POST, 'action');

    if ($accion === 'create') {
        // La creación valida datos del formulario en el servidor aunque también
        // existan validaciones visuales en el navegador.
        $idVehiculo = leerCampoReserva($_POST, 'id_vehiculo');
        $inicioOriginal = leerCampoReserva($_POST, 'fecha_inicio');
        $finOriginal = leerCampoReserva($_POST, 'fecha_fin');

        if (!validarIdReserva($idVehiculo)) {
            throw new ReservaApiException('El vehículo seleccionado no es válido.', 422);
        }

        $inicio = validarFechaReserva($inicioOriginal);
        $fin = validarFechaReserva($finOriginal);
        $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));

        if ($inicio === null || $fin === null) {
            throw new ReservaApiException('Ingresa fechas y horas válidas.', 422);
        }

        if ($inicio <= $ahora) {
            throw new ReservaApiException('La fecha y hora de inicio deben ser futuras.', 422);
        }

        if ($fin <= $inicio) {
            throw new ReservaApiException('La fecha y hora de fin deben ser posteriores al inicio.', 422);
        }

        // Sincroniza vencimientos antes de comprobar si el vehículo puede reservarse.
        $conexion->beginTransaction();
        sincronizarAlquileresVencidos($conexion, $ahora);
        $conexion->commit();

        // La transacción permite comprobar el estado e insertar de forma atómica.
        // FOR UPDATE bloquea la fila del vehículo y serializa intentos simultáneos
        // de reservar esa misma unidad. El bloqueo del usuario evita que dos
        // solicitudes simultáneas creen reservas activas para el mismo cliente.
        $conexion->beginTransaction();

        $consultaUsuarioBloqueo = $conexion->prepare(
            'SELECT rol, estado
             FROM usuarios
             WHERE id_usuario = :id_usuario
             FOR UPDATE'
        );
        $consultaUsuarioBloqueo->execute([
            ':id_usuario' => $usuarioSesion['id_usuario']
        ]);
        $usuarioBloqueado = $consultaUsuarioBloqueo->fetch(PDO::FETCH_ASSOC);

        if (
            !$usuarioBloqueado ||
            $usuarioBloqueado['rol'] !== 'cliente' ||
            (int) $usuarioBloqueado['estado'] !== 1
        ) {
            throw new ReservaApiException('La cuenta ya no está activa o no tiene permiso para reservar.', 403);
        }

        $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
        $consultaReservaActivaUsuario = $conexion->prepare(
            'SELECT id_alquiler
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

        if ($consultaReservaActivaUsuario->fetchColumn() !== false) {
            throw new ReservaApiException(
                'Ya tienes una reserva o alquiler vigente. Podrás reservar otro vehículo cuando termine o se cancele.',
                409
            );
        }

        $consultaVehiculo = $conexion->prepare(
            'SELECT v.estado_vehiculo, c.estado AS estado_categoria
             FROM vehiculos AS v
             INNER JOIN categorias_vehiculo AS c
                 ON c.id_categoria = v.id_categoria
             WHERE v.id_vehiculo = :id_vehiculo
             FOR UPDATE'
        );
        $consultaVehiculo->execute([':id_vehiculo' => $idVehiculo]);
        $estadoVehiculo = $consultaVehiculo->fetch(PDO::FETCH_ASSOC);

        if (!$estadoVehiculo || (int) $estadoVehiculo['estado_categoria'] !== 1) {
            throw new ReservaApiException('El vehículo no existe o su categoría no está activa.', 404);
        }

        if (strcasecmp((string) $estadoVehiculo['estado_vehiculo'], 'Disponible') !== 0) {
            throw new ReservaApiException('El vehículo ya no está disponible.', 409);
        }

        // Se ignoran solicitudes canceladas y solicitudes cuyo periodo ya terminó.
        // Cualquier otra solicitud vigente bloquea el vehículo globalmente,
        // incluso si el nuevo cliente propone fechas distintas.
        $consultaReservaActiva = $conexion->prepare(
            'SELECT id_alquiler
             FROM alquileres
             WHERE id_vehiculo = :id_vehiculo
               AND estado IN (0, 2)
               AND fecha_devolucion_programada > :ahora
             LIMIT 1
             FOR UPDATE'
        );
        $consultaReservaActiva->execute([
            ':id_vehiculo' => $idVehiculo,
            ':ahora' => $ahora->format('Y-m-d H:i:s')
        ]);

        if ($consultaReservaActiva->fetchColumn() !== false) {
            throw new ReservaApiException('El vehículo ya tiene una reserva pendiente y no está disponible hasta que finalice o se cancele.', 409);
        }

        // La tabla alquileres se reutiliza sin cambiar su esquema:
        // estado 0 representa una solicitud Pendiente.
        $consultaCrear = $conexion->prepare(
            'INSERT INTO alquileres
                (fecha_entrega, fecha_devolucion_programada, estado, id_vehiculo, id_usuario)
             VALUES
                (:fecha_inicio, :fecha_fin, :estado, :id_vehiculo, :id_usuario)'
        );
        $consultaCrear->execute([
            ':fecha_inicio' => $inicio->format('Y-m-d H:i:s'),
            ':fecha_fin' => $fin->format('Y-m-d H:i:s'),
            ':estado' => 0,
            ':id_vehiculo' => $idVehiculo,
            ':id_usuario' => $usuarioSesion['id_usuario']
        ]);

        // Sólo se confirma la transacción después de insertar correctamente.
        $idReserva = $conexion->lastInsertId();
        $conexion->commit();

        responderReserva([
            'ok' => true,
            'id_reserva' => $idReserva,
            'mensaje' => 'La solicitud de reserva se registró con estado Pendiente.'
        ], 201);
    }

    if ($accion === 'cancel' || $accion === 'delete') {
        $idReserva = leerCampoReserva($_POST, 'id_reserva');

        if (!validarIdReserva($idReserva)) {
            throw new ReservaApiException('La reserva seleccionada no es válida.', 422);
        }

        if ($accion === 'cancel') {
            // La actualización queda limitada al propietario y a solicitudes
            // Pendientes; al pasar a estado 1 deja de bloquear el vehículo.
            $consulta = $conexion->prepare(
                'UPDATE alquileres
                 SET estado = :cancelada
                 WHERE id_alquiler = :id_alquiler
                   AND id_usuario = :id_usuario
                   AND estado = :pendiente'
            );
            $consulta->execute([
                ':cancelada' => 1,
                ':id_alquiler' => $idReserva,
                ':id_usuario' => $usuarioSesion['id_usuario'],
                ':pendiente' => 0
            ]);

            if ($consulta->rowCount() === 0) {
                throw new ReservaApiException('No se encontró una reserva pendiente que puedas cancelar.', 404);
            }

            responderReserva(['ok' => true, 'mensaje' => 'La reserva se canceló correctamente.']);
        }

        // El borrado físico sólo está permitido al propietario y para registros
        // ya cancelados; así no se eliminan solicitudes activas del historial.
        $consulta = $conexion->prepare(
            'DELETE FROM alquileres
             WHERE id_alquiler = :id_alquiler
               AND id_usuario = :id_usuario
               AND estado = :cancelada'
        );
        $consulta->execute([
            ':id_alquiler' => $idReserva,
            ':id_usuario' => $usuarioSesion['id_usuario'],
            ':cancelada' => 1
        ]);

        if ($consulta->rowCount() === 0) {
            throw new ReservaApiException('Sólo puedes eliminar reservas canceladas de tu historial.', 404);
        }

        responderReserva(['ok' => true, 'mensaje' => 'La reserva cancelada se eliminó del historial.']);
    }

    responderReserva(['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'], 400);
} catch (ReservaApiException $error) {
    // Si una regla de negocio falla durante la creación, se revierte la operación
    // para no dejar bloqueos ni cambios parciales en la base de datos.
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }

    responderReserva(['ok' => false, 'mensaje' => $error->getMessage()], $error->httpStatus);
} catch (PDOException $error) {
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }

    // El detalle técnico se guarda en el log del servidor; al navegador se envía
    // un mensaje controlado para no revelar información interna de la base de datos.
    error_log('Error al gestionar reservas RentCars: ' . $error->getMessage());
    $codigoMysql = (int) ($error->errorInfo[1] ?? 0);

    if ($codigoMysql === 1451 || $codigoMysql === 1452) {
        responderReserva(['ok' => false, 'mensaje' => 'No se puede completar la operación porque el registro está relacionado con otros datos.'], 409);
    }

    responderReserva(['ok' => false, 'mensaje' => 'No fue posible guardar los cambios. Inténtalo de nuevo.'], 500);
} catch (Throwable $error) {
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }

    // Captura fallos no previstos, revierte cualquier transacción y responde
    // con un error genérico sin filtrar detalles internos al cliente.
    error_log('Error inesperado en reservas RentCars: ' . $error->getMessage());
    responderReserva(['ok' => false, 'mensaje' => 'Ocurrió un error interno. Inténtalo de nuevo.'], 500);
}

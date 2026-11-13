<?php

declare(strict_types=1);

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

final class AlquilerApiException extends RuntimeException
{
    public int $httpStatus;

    public function __construct(string $message, int $httpStatus)
    {
        parent::__construct($message);
        $this->httpStatus = $httpStatus;
    }
}

function responderAlquiler(array $respuesta, int $estadoHttp = 200): void
{
    http_response_code($estadoHttp);
    echo json_encode(
        $respuesta,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function leerCampoAlquiler(array $origen, string $campo): string
{
    $valor = $origen[$campo] ?? '';

    if (!is_string($valor)) {
        throw new AlquilerApiException('La solicitud contiene un campo inválido.', 400);
    }

    return trim($valor);
}

function validarIdAlquiler(string $id): bool
{
    return ctype_digit($id) && (int) $id > 0;
}

// Solo se exponen nombres de archivo con el formato generado por el sistema.
function rutaFotoAlquiler(?string $fotoGuardada): string
{
    if (!is_string($fotoGuardada) || $fotoGuardada === '') {
        return '';
    }

    $prefijo = 'Assets/Images/';

    if (str_starts_with($fotoGuardada, $prefijo)) {
        $fotoGuardada = substr($fotoGuardada, strlen($prefijo));
    }

    if (!preg_match('/\A[a-f0-9]{32}\.(?:jpg|png|webp)\z/', $fotoGuardada)) {
        return '';
    }

    return '../../Assets/Images/' . $fotoGuardada;
}

// La reserva y el alquiler comparten el registro: 0 pendiente, 1 reserva cancelada,
// 2 alquiler activo, 3 alquiler cancelado y 4 alquiler completado.
function estadoReservaAlquiler(int $estado): string
{
    return match ($estado) {
        0 => 'Pendiente',
        1 => 'Cancelada',
        2 => 'Convertida en alquiler',
        3 => 'Alquiler cancelado',
        4 => 'Completado',
        default => 'No disponible'
    };
}

// Completa alquileres vencidos, finaliza contratos activos y libera vehículos
// alquilados cuando no existe otra reserva o alquiler vigente para ellos.
function sincronizarAlquileresVencidos(PDO $conexion, DateTimeImmutable $ahora): void
{
    $fechaActual = $ahora->format('Y-m-d H:i:s');

    $completar = $conexion->prepare(
        'UPDATE alquileres
         SET estado = 4
         WHERE estado = 2
           AND fecha_devolucion_programada <= :ahora'
    );
    $completar->execute([':ahora' => $fechaActual]);

    $finalizarContratos = $conexion->prepare(
        'UPDATE contratos AS c
         INNER JOIN alquileres AS a ON a.id_alquiler = c.id_alquiler
         SET c.estado = 2
         WHERE a.estado = 4
           AND a.fecha_devolucion_programada <= :ahora
           AND c.estado = 1'
    );
    $finalizarContratos->execute([':ahora' => $fechaActual]);

    $liberarVehiculos = $conexion->prepare(
        "UPDATE vehiculos AS v
         SET v.estado_vehiculo = 'Disponible'
         WHERE v.estado_vehiculo = 'Alquilado'
           AND EXISTS (
               SELECT 1
               FROM alquileres AS vencido
               WHERE vencido.id_vehiculo = v.id_vehiculo
                 AND vencido.estado = 4
                 AND vencido.fecha_devolucion_programada <= :ahora
           )
           AND NOT EXISTS (
               SELECT 1
               FROM alquileres AS vigente
               WHERE vigente.id_vehiculo = v.id_vehiculo
                 AND vigente.estado IN (0, 2)
                 AND vigente.fecha_devolucion_programada > :ahora
           )"
    );
    $liberarVehiculos->execute([':ahora' => $fechaActual]);
}

// Libera un vehículo "Alquilado" cuando ya no tiene reservas ni alquileres vigentes.
// Preserva otros estados, como mantenimiento o inactivo.
function liberarVehiculoSinOperaciones(PDO $conexion, string $idVehiculo, DateTimeImmutable $ahora): void
{
    $liberar = $conexion->prepare(
        "UPDATE vehiculos AS v
         SET v.estado_vehiculo = 'Disponible'
         WHERE v.id_vehiculo = :id_vehiculo
           AND v.estado_vehiculo = 'Alquilado'
           AND NOT EXISTS (
               SELECT 1
               FROM alquileres AS vigente
               WHERE vigente.id_vehiculo = v.id_vehiculo
                 AND vigente.estado IN (0, 2)
                 AND vigente.fecha_devolucion_programada > :ahora
           )"
    );
    $liberar->execute([
        ':id_vehiculo' => $idVehiculo,
        ':ahora' => $ahora->format('Y-m-d H:i:s')
    ]);
}

// Prepara una fila para el historial; la disponibilidad también considera operaciones
// vigentes del vehículo, no solo el estado guardado en la tabla de vehículos.
function mapearReservaAlquiler(array $fila): array
{
    $vehiculo = [
        'id_vehiculo' => (string) $fila['id_vehiculo'],
        'placa' => $fila['placa'] ?? '',
        'marca' => $fila['marca'] ?? '',
        'modelo' => $fila['modelo'] ?? '',
        'anio' => $fila['anio'] ?? '',
        'color' => $fila['color'] ?? '',
        'estado' => $fila['estado_vehiculo'] ?? '',
        'disponible' => strcasecmp((string) ($fila['estado_vehiculo'] ?? ''), 'Disponible') === 0
            && (int) ($fila['otro_alquiler_activo'] ?? 0) === 0,
        'foto' => rutaFotoAlquiler($fila['foto_vehiculo'] ?? null),
        'id_categoria' => (string) $fila['id_categoria'],
        'categoria' => $fila['categoria'] ?? 'Sin categoría'
    ];

    $cliente = [
        'id_usuario' => (string) $fila['id_usuario'],
        'nombre' => $fila['nombre'] ?? '',
        'apellido' => $fila['apellido'] ?? '',
        'correo' => $fila['correo'] ?? '',
        'rol' => $fila['rol'] ?? '',
        'estado' => (int) ($fila['estado_usuario'] ?? 0) === 1 ? 'Activo' : 'Inactivo'
    ];

    return [
        'id_reserva' => (string) $fila['id_alquiler'],
        'id_alquiler' => (string) $fila['id_alquiler'],
        'id_vehiculo' => (string) $fila['id_vehiculo'],
        'fecha_inicio' => $fila['fecha_entrega'],
        'fecha_fin' => $fila['fecha_devolucion_programada'],
        'estado_codigo' => (int) $fila['estado'],
        'estado' => estadoReservaAlquiler((int) $fila['estado']),
        'puede_convertir' => (int) $fila['estado'] === 0 && $vehiculo['disponible'],
        'vehiculo' => $vehiculo,
        'cliente' => $cliente,
        'tipo_tarifa' => $fila['tipo_tarifa'],
        'valor_tarifa' => $fila['valor_tarifa'],
        'valor_total' => $fila['valor_total'],
        'kilometraje_inicial' => $fila['kilometraje_inicial']
    ];
}

// Otros endpoints pueden cargar esta función sin ejecutar el flujo HTTP de este controlador.
if (defined('RENTCARS_ALQUILER_HELPERS_ONLY')) {
    return;
}

$conexion = null;

try {
    $metodo = $_SERVER['REQUEST_METHOD'] ?? '';

    if (!in_array($metodo, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        responderAlquiler(['ok' => false, 'mensaje' => 'Método no permitido.'], 405);
    }

    $usuarioSesion = $_SESSION['usuario'] ?? null;

    if (
        !is_array($usuarioSesion) ||
        !isset($usuarioSesion['id_usuario']) ||
        (!is_int($usuarioSesion['id_usuario']) && !is_string($usuarioSesion['id_usuario'])) ||
        !ctype_digit((string) $usuarioSesion['id_usuario'])
    ) {
        responderAlquiler(['ok' => false, 'mensaje' => 'Inicia sesión para continuar.'], 401);
    }

    require_once __DIR__ . '/../../config/database.php';

    $consultaUsuario = $conexion->prepare(
        'SELECT rol, estado
         FROM usuarios
         WHERE id_usuario = :id_usuario
         LIMIT 1'
    );
    $consultaUsuario->execute([':id_usuario' => $usuarioSesion['id_usuario']]);
    $usuario = $consultaUsuario->fetch(PDO::FETCH_ASSOC);

    if (!$usuario || (int) $usuario['estado'] !== 1) {
        $_SESSION = [];
        session_destroy();
        responderAlquiler(['ok' => false, 'mensaje' => 'La sesión ya no está activa.'], 401);
    }

    if ($usuario['rol'] !== 'empleado') {
        responderAlquiler(['ok' => false, 'mensaje' => 'Solo un empleado puede gestionar alquileres.'], 403);
    }

    if ($metodo === 'GET') {
        if (($_GET['action'] ?? '') !== 'init') {
            responderAlquiler(['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'], 400);
        }

        // El token protege las acciones de escritura que se ejecutan desde este historial.
        if (!isset($_SESSION['csrf_alquileres'])) {
            $_SESSION['csrf_alquileres'] = bin2hex(random_bytes(32));
        }

        // Actualiza los estados persistidos antes de construir ambos historiales.
        $conexion->beginTransaction();
        sincronizarAlquileresVencidos(
            $conexion,
            new DateTimeImmutable('now', new DateTimeZone('America/Bogota'))
        );
        $conexion->commit();

        // La carga inicial devuelve reservas y alquileres desde la misma tabla para
        // conservar el historial sin duplicar registros.
        $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
        $consultaReservas = $conexion->prepare(
            'SELECT a.id_alquiler, a.fecha_entrega, a.fecha_devolucion_programada,
                    a.kilometraje_inicial, a.tipo_tarifa, a.valor_tarifa,
                    a.valor_total, a.estado, a.id_vehiculo, a.id_usuario,
                    v.placa, v.marca, v.modelo, v.`año` AS anio, v.color,
                    v.estado_vehiculo, v.foto_vehiculo, v.id_categoria,
                    c.nombre AS categoria,
                    u.nombre, u.apellido, u.correo, u.rol, u.estado AS estado_usuario,
                    EXISTS (
                        SELECT 1
                        FROM alquileres AS otro
                        WHERE otro.id_vehiculo = a.id_vehiculo
                          AND otro.id_alquiler <> a.id_alquiler
                          AND otro.estado IN (0, 2)
                          AND otro.fecha_devolucion_programada > :ahora
                    ) AS otro_alquiler_activo
             FROM alquileres AS a
             INNER JOIN vehiculos AS v ON v.id_vehiculo = a.id_vehiculo
             INNER JOIN categorias_vehiculo AS c ON c.id_categoria = v.id_categoria
             INNER JOIN usuarios AS u ON u.id_usuario = a.id_usuario
             WHERE a.estado IN (0, 1, 2, 3, 4)
             ORDER BY a.id_alquiler DESC'
        );
        $consultaReservas->execute([':ahora' => $ahora->format('Y-m-d H:i:s')]);
        $reservas = array_map('mapearReservaAlquiler', $consultaReservas->fetchAll(PDO::FETCH_ASSOC));

        $alquileres = array_values(array_filter(
            $reservas,
            static fn (array $reserva): bool => in_array($reserva['estado_codigo'], [2, 3, 4], true)
        ));

        // El historial distingue cancelados, vigentes y vencidos desde el estado persistido.
        foreach ($alquileres as &$alquiler) {
            if ($alquiler['estado_codigo'] === 3) {
                $alquiler['estado'] = 'Cancelado';
                $alquiler['puede_cancelar'] = false;
                continue;
            }

            $alquiler['estado'] = $alquiler['estado_codigo'] === 4 ? 'Completado' : 'Activo';
            $alquiler['puede_cancelar'] = $alquiler['estado_codigo'] === 2;
        }
        unset($alquiler);

        responderAlquiler([
            'ok' => true,
            'csrf_token' => $_SESSION['csrf_alquileres'],
            'reservas' => $reservas,
            'alquileres' => $alquileres
        ]);
    }

    $token = leerCampoAlquiler($_POST, 'csrf_token');

    if (
        !isset($_SESSION['csrf_alquileres']) ||
        !hash_equals($_SESSION['csrf_alquileres'], $token)
    ) {
        responderAlquiler(['ok' => false, 'mensaje' => 'La solicitud venció. Actualiza la página e inténtalo de nuevo.'], 403);
    }

    $accion = leerCampoAlquiler($_POST, 'action');

    if ($accion === 'cancel') {
        // Cancelar una reserva cambia su estado a 1 y conserva el registro en el historial.
        $idReserva = leerCampoAlquiler($_POST, 'id_reserva');

        if (!validarIdAlquiler($idReserva)) {
            throw new AlquilerApiException('La reserva seleccionada no es válida.', 422);
        }

        $cancelar = $conexion->prepare(
            'UPDATE alquileres
             SET estado = :cancelada
             WHERE id_alquiler = :id_alquiler
               AND estado = :pendiente'
        );
        $cancelar->execute([
            ':cancelada' => 1,
            ':id_alquiler' => $idReserva,
            ':pendiente' => 0
        ]);

        if ($cancelar->rowCount() !== 1) {
            throw new AlquilerApiException(
                'La reserva ya no está pendiente o fue cancelada anteriormente. Actualiza el historial.',
                409
            );
        }

        responderAlquiler([
            'ok' => true,
            'mensaje' => 'La reserva se canceló y permanece en el historial.'
        ]);
    }

    if ($accion === 'cancel_rental') {
        // Solo se cancela un alquiler convertido que aún no ha vencido; el estado 3
        // conserva el registro y deja de contarse como operación vigente.
        $idAlquiler = leerCampoAlquiler($_POST, 'id_alquiler');

        if (!validarIdAlquiler($idAlquiler)) {
            throw new AlquilerApiException('El alquiler seleccionado no es válido.', 422);
        }

        $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
        $conexion->beginTransaction();
        $cancelarAlquiler = $conexion->prepare(
            'UPDATE alquileres
             SET estado = :cancelado
             WHERE id_alquiler = :id_alquiler
               AND estado = :convertido
               AND fecha_devolucion_programada > :ahora'
        );
        $cancelarAlquiler->execute([
            ':cancelado' => 3,
            ':id_alquiler' => $idAlquiler,
            ':convertido' => 2,
            ':ahora' => $ahora->format('Y-m-d H:i:s')
        ]);

        if ($cancelarAlquiler->rowCount() !== 1) {
            throw new AlquilerApiException(
                'Solo se pueden cancelar alquileres activos. Actualiza el historial e inténtalo de nuevo.',
                409
            );
        }

        $consultaVehiculoCancelado = $conexion->prepare(
            'SELECT id_vehiculo FROM alquileres WHERE id_alquiler = :id_alquiler'
        );
        $consultaVehiculoCancelado->execute([':id_alquiler' => $idAlquiler]);
        $idVehiculoCancelado = $consultaVehiculoCancelado->fetchColumn();

        if ($idVehiculoCancelado !== false) {
            liberarVehiculoSinOperaciones($conexion, (string) $idVehiculoCancelado, $ahora);
        }

        $conexion->commit();


        responderAlquiler([
            'ok' => true,
            'mensaje' => 'El alquiler se canceló, permanece en el historial y el vehículo quedó disponible.'
        ]);
    }

    if ($accion !== 'convert') {
        responderAlquiler(['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'], 400);
    }

    // El servidor valida la tarifa recibida y calcula el total desde las fechas guardadas
    // en la reserva; no confía en un total calculado por el navegador.
    $idReserva = leerCampoAlquiler($_POST, 'id_reserva');
    $tipoTarifa = leerCampoAlquiler($_POST, 'tipo_tarifa');
    $valorTarifaOriginal = leerCampoAlquiler($_POST, 'valor_tarifa');
    $kilometrajeOriginal = leerCampoAlquiler($_POST, 'kilometraje_inicial');

    if (!validarIdAlquiler($idReserva)) {
        throw new AlquilerApiException('La reserva seleccionada no es válida.', 422);
    }

    if (!in_array($tipoTarifa, ['Por hora', 'Diaria'], true)) {
        throw new AlquilerApiException('Selecciona un tipo de tarifa válido.', 422);
    }

    if (
        !is_numeric($valorTarifaOriginal) ||
        !is_finite((float) $valorTarifaOriginal) ||
        (float) $valorTarifaOriginal <= 0 ||
        (float) $valorTarifaOriginal > 1000000000000
    ) {
        throw new AlquilerApiException('El valor de la tarifa debe ser mayor que cero y válido.', 422);
    }
    $valorTarifa = (float) $valorTarifaOriginal;

    // El kilometraje es opcional, pero si se informa debe ser un entero no negativo.
    $kilometraje = null;
    if ($kilometrajeOriginal !== '') {
        $kilometrajeNormalizado = ltrim($kilometrajeOriginal, '0');
        $kilometrajeNormalizado = $kilometrajeNormalizado === ''
            ? '0'
            : $kilometrajeNormalizado;
        $kilometrajeValidado = ctype_digit($kilometrajeOriginal)
            ? filter_var($kilometrajeNormalizado, FILTER_VALIDATE_INT)
            : false;

        if ($kilometrajeValidado === false) {
            throw new AlquilerApiException('El kilometraje debe ser un entero igual o mayor que cero.', 422);
        }

        $kilometraje = $kilometrajeValidado;
    }

    // La transacción bloquea el vehículo y la reserva para validar su estado actual y evitar
    // conversiones simultáneas incompatibles.
    $conexion->beginTransaction();

    $consultaVehiculoReserva = $conexion->prepare(
        'SELECT id_vehiculo
         FROM alquileres
         WHERE id_alquiler = :id_alquiler'
    );
    $consultaVehiculoReserva->execute([':id_alquiler' => $idReserva]);
    $idVehiculo = $consultaVehiculoReserva->fetchColumn();

    if ($idVehiculo === false) {
        throw new AlquilerApiException('No se encontró la reserva seleccionada.', 404);
    }

    $consultaBloquearVehiculo = $conexion->prepare(
        'SELECT estado_vehiculo
         FROM vehiculos
         WHERE id_vehiculo = :id_vehiculo
         FOR UPDATE'
    );
    $consultaBloquearVehiculo->execute([':id_vehiculo' => $idVehiculo]);
    $estadoVehiculo = $consultaBloquearVehiculo->fetchColumn();

    if ($estadoVehiculo === false) {
        throw new AlquilerApiException('El vehículo asociado ya no existe.', 404);
    }

    $consultaReserva = $conexion->prepare(
        'SELECT a.id_alquiler, a.fecha_entrega, a.fecha_devolucion_programada,
                a.estado, a.id_vehiculo, a.id_usuario,
                v.estado_vehiculo, u.estado AS estado_usuario
         FROM alquileres AS a
         INNER JOIN vehiculos AS v ON v.id_vehiculo = a.id_vehiculo
         INNER JOIN usuarios AS u ON u.id_usuario = a.id_usuario
         WHERE a.id_alquiler = :id_alquiler
         FOR UPDATE'
    );
    $consultaReserva->execute([':id_alquiler' => $idReserva]);
    $reserva = $consultaReserva->fetch(PDO::FETCH_ASSOC);

    if (!$reserva || (string) $reserva['id_vehiculo'] !== (string) $idVehiculo) {
        throw new AlquilerApiException('La reserva cambió. Actualiza la página e inténtalo de nuevo.', 409);
    }

    if ((int) $reserva['estado'] !== 0) {
        throw new AlquilerApiException('La reserva ya no está pendiente o ya fue convertida.', 409);
    }

    if ((int) $reserva['estado_usuario'] !== 1) {
        throw new AlquilerApiException('El cliente asociado no tiene una cuenta activa.', 409);
    }

    if (strcasecmp((string) $reserva['estado_vehiculo'], 'Disponible') !== 0) {
        throw new AlquilerApiException('El vehículo no está disponible para el alquiler.', 409);
    }

    $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
    $inicio = new DateTimeImmutable((string) $reserva['fecha_entrega'], new DateTimeZone('America/Bogota'));
    $fin = new DateTimeImmutable((string) $reserva['fecha_devolucion_programada'], new DateTimeZone('America/Bogota'));

    if ($fin <= $inicio) {
        throw new AlquilerApiException('El intervalo reservado no es válido.', 409);
    }

    if ($fin <= $ahora) {
        throw new AlquilerApiException('La reserva ya venció y no se puede convertir en alquiler.', 409);
    }

    $consultaOtroAlquiler = $conexion->prepare(
        'SELECT id_alquiler
         FROM alquileres
         WHERE id_vehiculo = :id_vehiculo
           AND id_alquiler <> :id_alquiler
           AND estado IN (0, 2)
           AND fecha_devolucion_programada > :ahora
         LIMIT 1'
    );
    $consultaOtroAlquiler->execute([
        ':id_vehiculo' => $idVehiculo,
        ':id_alquiler' => $idReserva,
        ':ahora' => $ahora->format('Y-m-d H:i:s')
    ]);

    if ($consultaOtroAlquiler->fetchColumn() !== false) {
        throw new AlquilerApiException('El vehículo tiene otra reserva o alquiler vigente.', 409);
    }

    // La tarifa diaria se prorratea por segundos transcurridos (segundos / 86.400);
    // la tarifa por hora usa segundos / 3.600. El importe final se redondea a dos decimales.
    $duracionSegundos = $fin->getTimestamp() - $inicio->getTimestamp();
    $unidades = $tipoTarifa === 'Por hora'
        ? $duracionSegundos / 3600
        : $duracionSegundos / 86400;
    $valorTotal = round($unidades * $valorTarifa, 2);

    if (!is_finite($valorTotal) || $valorTotal <= 0) {
        throw new AlquilerApiException('No se pudo calcular un valor total válido.', 422);
    }

    $actualizar = $conexion->prepare(
        'UPDATE alquileres
         SET kilometraje_inicial = :kilometraje_inicial,
             tipo_tarifa = :tipo_tarifa,
             valor_tarifa = :valor_tarifa,
             valor_total = :valor_total,
             estado = :convertido
         WHERE id_alquiler = :id_alquiler
           AND estado = :pendiente'
    );
    $actualizar->execute([
        ':kilometraje_inicial' => $kilometraje,
        ':tipo_tarifa' => $tipoTarifa,
        ':valor_tarifa' => $valorTarifa,
        ':valor_total' => $valorTotal,
        ':convertido' => 2,
        ':id_alquiler' => $idReserva,
        ':pendiente' => 0
    ]);

    // La conversión actualiza la reserva existente a estado 2, manteniendo el historial.
    if ($actualizar->rowCount() !== 1) {
        throw new AlquilerApiException('La reserva ya no está pendiente. Actualiza el historial.', 409);
    }

    $conexion->commit();

    responderAlquiler([
        'ok' => true,
        'mensaje' => 'El alquiler se registró correctamente.',
        'valor_total' => $valorTotal
    ]);
} catch (AlquilerApiException $error) {
    // Si una operación falla después de abrir la transacción, se revierten los cambios pendientes.
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }

    responderAlquiler(['ok' => false, 'mensaje' => $error->getMessage()], $error->httpStatus);
} catch (PDOException $error) {
    // También se revierte la transacción ante errores de base de datos.
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }

    error_log('Error al gestionar alquileres RentCars: ' . $error->getMessage());
    responderAlquiler(['ok' => false, 'mensaje' => 'No fue posible guardar los cambios. Inténtalo de nuevo.'], 500);
} catch (Throwable $error) {
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }

    error_log('Error inesperado en alquileres RentCars: ' . $error->getMessage());
    responderAlquiler(['ok' => false, 'mensaje' => 'Ocurrió un error interno. Inténtalo de nuevo.'], 500);
}
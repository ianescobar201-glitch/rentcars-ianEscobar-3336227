<?php

declare(strict_types=1);

// API del módulo de alquileres: consulta alquileres y contratos, guarda contratos y entrega sus PDF.
session_start();

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

final class DetalleAlquilerApiException extends RuntimeException
{
    public int $httpStatus;

    // Permite asociar errores de validación o negocio con el código HTTP que recibirá el cliente.
    public function __construct(string $message, int $httpStatus)
    {
        parent::__construct($message);
        $this->httpStatus = $httpStatus;
    }
}

// Envía una respuesta JSON y termina la ejecución del endpoint.
function responderDetalleAlquiler(array $respuesta, int $estadoHttp = 200): void
{
    http_response_code($estadoHttp);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(
        $respuesta,
        JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

// Obtiene un valor de entrada como texto y estandariza los saltos de línea de los formularios.
function leerCampoDetalleAlquiler(array $origen, string $campo): string
{
    $valor = $origen[$campo] ?? '';

    if (!is_string($valor)) {
        throw new DetalleAlquilerApiException('La solicitud contiene un campo inválido.', 422);
    }

    // Normaliza los saltos multipart: cada salto cuenta como un carácter, igual que en el textarea.
    return str_replace(["\r\n", "\r"], "\n", trim($valor));
}

// Comprueba que un identificador recibido sea un entero positivo.
function validarIdDetalleAlquiler(string $id): bool
{
    return ctype_digit($id) && (int) $id > 0;
}

// Convierte una fecha del formulario a la zona horaria del proyecto y rechaza fechas inválidas.
function validarFechaDetalleAlquiler(string $valor): ?DateTimeImmutable
{
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

// Traduce el estado legible del formulario al código almacenado en la base de datos.
function codigoEstadoContratoDetalle(string $estado): ?int
{
    return match ($estado) {
        'Pendiente de generación' => 0,
        'Activo' => 1,
        'Finalizado' => 2,
        'Cancelado' => 3,
        default => null
    };
}

// Traduce el código de estado de la base de datos a la etiqueta que consume la interfaz.
function etiquetaEstadoContratoDetalle(int $estado): string
{
    return match ($estado) {
        0 => 'Pendiente de generación',
        1 => 'Activo',
        2 => 'Finalizado',
        3 => 'Cancelado',
        default => 'No disponible'
    };
}

// Valida el nombre de la foto antes de crear una ruta pública para mostrarla.
function rutaFotoDetalleAlquiler(?string $fotoGuardada): string
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

// Obtiene la carpeta privada donde se almacenan los PDF, fuera del directorio público del sitio.
function directorioPdfDetalleAlquiler(): string
{
    $raizWeb = realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
    if ($raizWeb === false) {
        throw new DetalleAlquilerApiException('No está configurado el directorio web para guardar contratos.', 500);
    }

    return dirname($raizWeb) . DIRECTORY_SEPARATOR . 'rentcars-private'
        . DIRECTORY_SEPARATOR . 'contratos';
}

// Organiza los datos de una fila SQL de alquiler en el formato que espera la interfaz.
function mapearAlquilerDetalle(array $fila, DateTimeImmutable $ahora): array
{
    $estadoCodigo = (int) $fila['estado'];
    $fechaDevolucion = new DateTimeImmutable(
        (string) $fila['fecha_devolucion_programada'],
        new DateTimeZone('America/Bogota')
    );
    $estado = match ($estadoCodigo) {
        3 => 'Cancelado',
        4 => 'Completado',
        default => $fechaDevolucion > $ahora ? 'Activo' : 'Completado'
    };

    return [
        'id_alquiler' => (string) $fila['id_alquiler'],
        'id_vehiculo' => (string) $fila['id_vehiculo'],
        'id_usuario' => (string) $fila['id_usuario'],
        'fecha_entrega' => $fila['fecha_entrega'],
        'fecha_devolucion_programada' => $fila['fecha_devolucion_programada'],
        'fecha_devolucion' => $fila['fecha_devolucion_programada'],
        'tipo_tarifa' => $fila['tipo_tarifa'],
        'valor_tarifa' => $fila['valor_tarifa'],
        'kilometraje_inicial' => $fila['kilometraje_inicial'],
        'valor_total' => $fila['valor_total'],
        'estado_codigo' => $estadoCodigo,
        'estado' => $estado,
        'cliente' => [
            'id_usuario' => (string) $fila['id_usuario'],
            'nombre' => $fila['nombre'],
            'apellido' => $fila['apellido'],
            'correo' => $fila['correo'],
            'rol' => $fila['rol'],
            'estado' => (int) $fila['estado_usuario'] === 1 ? 'Activo' : 'Inactivo'
        ],
        'vehiculo' => [
            'id_vehiculo' => (string) $fila['id_vehiculo'],
            'placa' => $fila['placa'],
            'marca' => $fila['marca'],
            'modelo' => $fila['modelo'],
            'anio' => $fila['anio'],
            'color' => $fila['color'],
            'estado' => $fila['estado_vehiculo'],
            'foto' => rutaFotoDetalleAlquiler($fila['foto_vehiculo']),
            'id_categoria' => (string) $fila['id_categoria'],
            'nombre_categoria' => $fila['nombre_categoria']
        ]
    ];
}

// Consulta los alquileres permitidos y los prepara junto con sus datos de cliente y vehículo.
function consultarAlquileresDetalle(PDO $conexion): array
{
    $consulta = $conexion->prepare(
        'SELECT a.id_alquiler, a.fecha_entrega, a.fecha_devolucion_programada,
                a.kilometraje_inicial, a.tipo_tarifa, a.valor_tarifa,
                a.valor_total, a.estado, a.id_vehiculo, a.id_usuario,
                v.placa, v.marca, v.modelo, v.`año` AS anio, v.color,
                v.estado_vehiculo, v.foto_vehiculo, v.id_categoria,
                c.nombre AS nombre_categoria,
                u.nombre, u.apellido, u.correo, u.rol, u.estado AS estado_usuario
         FROM alquileres AS a
         INNER JOIN vehiculos AS v ON v.id_vehiculo = a.id_vehiculo
         INNER JOIN categorias_vehiculo AS c ON c.id_categoria = v.id_categoria
         INNER JOIN usuarios AS u ON u.id_usuario = a.id_usuario
         WHERE a.estado IN (2, 3, 4)
         ORDER BY a.id_alquiler DESC'
    );
    $consulta->execute();

    $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
    return array_map(
        static fn (array $fila): array => mapearAlquilerDetalle($fila, $ahora),
        $consulta->fetchAll(PDO::FETCH_ASSOC)
    );
}

// Organiza los datos de contrato, cliente y vehículo en el formato de respuesta de la API.
function mapearContratoDetalle(array $fila): array
{
    $estadoCodigo = (int) $fila['estado'];
    $archivo = $fila['archivo_contrato'] ?: null;

    return [
        'id_contrato' => (string) $fila['id_contrato'],
        'id_alquiler' => (string) $fila['id_alquiler'],
        'id_vehiculo' => (string) $fila['id_vehiculo'],
        'id_usuario' => (string) $fila['id_usuario'],
        'numero_contrato' => $fila['numero_contrato'],
        'fecha_generacion' => $fila['fecha_generacion'],
        'fecha_inicio' => $fila['fecha_inicio'],
        'fecha_fin' => $fila['fecha_fin'],
        'tipo_tarifa' => $fila['tipo_tarifa'],
        'valor_tarifa' => $fila['valor_tarifa'],
        'kilometraje_inicial' => $fila['kilometraje_inicial'],
        'kilometraje_final' => $fila['kilometraje_final'],
        'valor_total' => $fila['valor_total'],
        'condiciones' => $fila['condiciones'],
        'observaciones' => $fila['observaciones'],
        'archivo_contrato' => $archivo,
        'archivo_contrato_url' => $archivo !== null
            ? '../../controllers/alquileres/detalle.php?action=download_pdf&id_contrato='
                . rawurlencode((string) $fila['id_contrato'])
            : '',
        'estado_codigo' => $estadoCodigo,
        'estado' => etiquetaEstadoContratoDetalle($estadoCodigo),
        'cliente' => [
            'id_usuario' => (string) $fila['id_usuario'],
            'nombre' => $fila['nombre_cliente'],
            'apellido' => $fila['apellido_cliente'],
            'correo' => $fila['correo_cliente'],
            'rol' => $fila['rol_cliente'],
            'estado' => (int) $fila['estado_cliente'] === 1 ? 'Activo' : 'Inactivo'
        ],
        'vehiculo' => [
            'id_vehiculo' => (string) $fila['id_vehiculo'],
            'placa' => $fila['placa'],
            'marca' => $fila['marca'],
            'modelo' => $fila['modelo'],
            'anio' => $fila['anio'],
            'color' => $fila['color'],
            'foto' => rutaFotoDetalleAlquiler($fila['foto_vehiculo']),
            'id_categoria' => (string) $fila['id_categoria'],
            'nombre_categoria' => $fila['nombre_categoria']
        ]
    ];
}

// Consulta el historial completo de contratos con la información relacionada para la interfaz.
function consultarContratosDetalle(PDO $conexion): array
{
    $consulta = $conexion->prepare(
        'SELECT c.*, a.id_vehiculo,
                u.nombre AS nombre_cliente, u.apellido AS apellido_cliente,
                u.correo AS correo_cliente, u.rol AS rol_cliente,
                u.estado AS estado_cliente,
                v.placa, v.marca, v.modelo, v.`año` AS anio, v.color,
                v.foto_vehiculo, v.id_categoria, cat.nombre AS nombre_categoria
         FROM contratos AS c
         INNER JOIN alquileres AS a ON a.id_alquiler = c.id_alquiler
         INNER JOIN usuarios AS u ON u.id_usuario = c.id_usuario
         INNER JOIN vehiculos AS v ON v.id_vehiculo = a.id_vehiculo
         INNER JOIN categorias_vehiculo AS cat ON cat.id_categoria = v.id_categoria
         ORDER BY c.fecha_generacion DESC, c.id_contrato DESC'
    );
    $consulta->execute();

    return array_map('mapearContratoDetalle', $consulta->fetchAll(PDO::FETCH_ASSOC));
}

// Busca un contrato por identificador y devuelve sus datos relacionados o null si no existe.
function consultarContratoDetalle(PDO $conexion, int $idContrato): ?array
{
    $consulta = $conexion->prepare(
        'SELECT c.*, a.id_vehiculo,
                u.nombre AS nombre_cliente, u.apellido AS apellido_cliente,
                u.correo AS correo_cliente, u.rol AS rol_cliente,
                u.estado AS estado_cliente,
                v.placa, v.marca, v.modelo, v.`año` AS anio, v.color,
                v.foto_vehiculo, v.id_categoria, cat.nombre AS nombre_categoria
         FROM contratos AS c
         INNER JOIN alquileres AS a ON a.id_alquiler = c.id_alquiler
         INNER JOIN usuarios AS u ON u.id_usuario = c.id_usuario
         INNER JOIN vehiculos AS v ON v.id_vehiculo = a.id_vehiculo
         INNER JOIN categorias_vehiculo AS cat ON cat.id_categoria = v.id_categoria
         WHERE c.id_contrato = :id_contrato
         LIMIT 1'
    );
    $consulta->execute([':id_contrato' => $idContrato]);
    $fila = $consulta->fetch(PDO::FETCH_ASSOC);

    return $fila ? mapearContratoDetalle($fila) : null;
}

// Valida importes y kilometrajes, con opción de exigir que el valor sea entero.
function validarNumeroNoNegativoDetalle(string $valor, string $etiqueta, bool $entero = false): float
{
    if (
        $valor === '' ||
        !is_numeric($valor) ||
        !is_finite((float) $valor) ||
        (float) $valor < 0 ||
        (float) $valor > 1000000000000 ||
        ($entero && floor((float) $valor) !== (float) $valor)
    ) {
        throw new DetalleAlquilerApiException($etiqueta . ' debe ser un número válido igual o mayor que cero.', 422);
    }

    return (float) $valor;
}

// Verifica que el archivo subido sea un PDF real dentro del límite de tamaño permitido.
function validarArchivoPdfDetalle(array $archivo): void
{
    if (($archivo['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return;
    }

    if (($archivo['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new DetalleAlquilerApiException('No fue posible recibir el archivo PDF.', 422);
    }

    $rutaTemporal = $archivo['tmp_name'] ?? '';
    if (
        !is_string($rutaTemporal) ||
        !is_uploaded_file($rutaTemporal) ||
        (int) ($archivo['size'] ?? 0) <= 0 ||
        (int) $archivo['size'] > 1024 * 1024
    ) {
        throw new DetalleAlquilerApiException('El PDF debe pesar más de 0 y como máximo 1 MB.', 422);
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $tipo = $finfo->file($rutaTemporal);
    $cabecera = file_get_contents($rutaTemporal, false, null, 0, 5);
    if ($tipo !== 'application/pdf' || $cabecera !== '%PDF-') {
        throw new DetalleAlquilerApiException('El archivo adjunto no es un PDF válido.', 422);
    }
}

$conexion = null;
$archivoNuevo = null;

// El flujo principal autoriza al empleado, atiende consultas GET y procesa el guardado por POST.
try {
    $metodo = $_SERVER['REQUEST_METHOD'] ?? '';
    if (!in_array($metodo, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        responderDetalleAlquiler(['ok' => false, 'mensaje' => 'Método no permitido.'], 405);
    }

    // La sesión y el estado actual de la cuenta se comprueban antes de permitir cualquier operación.
    $usuarioSesion = $_SESSION['usuario'] ?? null;
    if (
        !is_array($usuarioSesion) ||
        !isset($usuarioSesion['id_usuario']) ||
        (!is_int($usuarioSesion['id_usuario']) && !is_string($usuarioSesion['id_usuario'])) ||
        !ctype_digit((string) $usuarioSesion['id_usuario'])
    ) {
        responderDetalleAlquiler(['ok' => false, 'mensaje' => 'Inicia sesión para continuar.'], 401);
    }

    define('RENTCARS_ALQUILER_HELPERS_ONLY', true);
    require_once __DIR__ . '/nuevo.php';
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
        responderDetalleAlquiler(['ok' => false, 'mensaje' => 'La sesión ya no está activa.'], 401);
    }

    if ($usuario['rol'] !== 'empleado') {
        responderDetalleAlquiler(['ok' => false, 'mensaje' => 'Solo un empleado puede gestionar contratos.'], 403);
    }

    if ($metodo === 'GET') {
        // GET init entrega datos y token CSRF; GET download_pdf sirve archivos privados tras validar el contrato.
        $accion = $_GET['action'] ?? '';

        if ($accion === 'init') {
            if (!isset($_SESSION['csrf_detalle_alquileres'])) {
                $_SESSION['csrf_detalle_alquileres'] = bin2hex(random_bytes(32));
            }

            $conexion->beginTransaction();
            sincronizarAlquileresVencidos(
                $conexion,
                new DateTimeImmutable('now', new DateTimeZone('America/Bogota'))
            );
            $conexion->commit();

            responderDetalleAlquiler([
                'ok' => true,
                'csrf_token' => $_SESSION['csrf_detalle_alquileres'],
                'alquileres' => consultarAlquileresDetalle($conexion),
                'contratos' => consultarContratosDetalle($conexion)
            ]);
        }

        if ($accion === 'download_pdf') {
            $idContrato = $_GET['id_contrato'] ?? '';
            if (!is_string($idContrato) || !validarIdDetalleAlquiler($idContrato)) {
                responderDetalleAlquiler(['ok' => false, 'mensaje' => 'El contrato solicitado no es válido.'], 422);
            }

            $consultaPdf = $conexion->prepare(
                'SELECT archivo_contrato, numero_contrato
                 FROM contratos
                 WHERE id_contrato = :id_contrato
                 LIMIT 1'
            );
            $consultaPdf->execute([':id_contrato' => $idContrato]);
            $contratoPdf = $consultaPdf->fetch(PDO::FETCH_ASSOC);

            if (!$contratoPdf) {
                responderDetalleAlquiler(['ok' => false, 'mensaje' => 'No se encontró el contrato solicitado.'], 404);
            }
            if (!$contratoPdf['archivo_contrato']) {
                responderDetalleAlquiler(['ok' => false, 'mensaje' => 'El contrato no tiene un PDF adjunto.'], 404);
            }

            $nombreArchivo = (string) $contratoPdf['archivo_contrato'];
            if (!preg_match('/\A[a-f0-9]{32}\.pdf\z/', $nombreArchivo)) {
                throw new DetalleAlquilerApiException('La referencia del archivo no es válida.', 500);
            }

            $rutaPdf = directorioPdfDetalleAlquiler() . DIRECTORY_SEPARATOR . $nombreArchivo;
            if (!is_file($rutaPdf) || !is_readable($rutaPdf)) {
                responderDetalleAlquiler(['ok' => false, 'mensaje' => 'No se encontró el PDF guardado.'], 404);
            }

            $numeroSeguro = preg_replace('/[^A-Za-z0-9_-]/', '', (string) $contratoPdf['numero_contrato']);
            header('Content-Type: application/pdf');
            header('Content-Length: ' . (string) filesize($rutaPdf));
            header('Content-Disposition: attachment; filename="Contrato-' . $numeroSeguro . '.pdf"');
            readfile($rutaPdf);
            exit;
        }

        responderDetalleAlquiler(['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'], 400);
    }

    // Para modificar datos se exige un token asociado a la sesión y una acción explícita de guardado.
    $token = leerCampoDetalleAlquiler($_POST, 'csrf_token');
    if (
        !isset($_SESSION['csrf_detalle_alquileres']) ||
        !hash_equals($_SESSION['csrf_detalle_alquileres'], $token)
    ) {
        responderDetalleAlquiler(['ok' => false, 'mensaje' => 'La solicitud venció. Actualiza la página e inténtalo de nuevo.'], 403);
    }

    if (leerCampoDetalleAlquiler($_POST, 'action') !== 'save_contract') {
        responderDetalleAlquiler(['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'], 400);
    }

    // Los datos del formulario se normalizan y validan en el servidor antes de consultar o modificar la BD.
    $idAlquiler = leerCampoDetalleAlquiler($_POST, 'id_alquiler');
    if (!validarIdDetalleAlquiler($idAlquiler)) {
        throw new DetalleAlquilerApiException('El alquiler seleccionado no es válido.', 422);
    }

    $numeroContrato = leerCampoDetalleAlquiler($_POST, 'numero_contrato');
    $fechaGeneracionTexto = leerCampoDetalleAlquiler($_POST, 'fecha_generacion');
    $fechaInicioTexto = leerCampoDetalleAlquiler($_POST, 'fecha_inicio');
    $fechaFinTexto = leerCampoDetalleAlquiler($_POST, 'fecha_fin');
    $tipoTarifa = leerCampoDetalleAlquiler($_POST, 'tipo_tarifa');
    $valorTarifaTexto = leerCampoDetalleAlquiler($_POST, 'valor_tarifa');
    $kilometrajeInicialTexto = leerCampoDetalleAlquiler($_POST, 'kilometraje_inicial');
    $kilometrajeFinalTexto = leerCampoDetalleAlquiler($_POST, 'kilometraje_final');
    $valorTotalTexto = leerCampoDetalleAlquiler($_POST, 'valor_total');
    $condiciones = leerCampoDetalleAlquiler($_POST, 'condiciones');
    $observaciones = leerCampoDetalleAlquiler($_POST, 'observaciones');
    $estadoTexto = leerCampoDetalleAlquiler($_POST, 'estado');
    $estadoCodigo = codigoEstadoContratoDetalle($estadoTexto);

    if ($numeroContrato === '' || mb_strlen($numeroContrato, 'UTF-8') > 60) {
        throw new DetalleAlquilerApiException('El número de contrato es obligatorio y no debe superar 60 caracteres.', 422);
    }

    // Los límites de 10.000 y 5.000 caracteres permiten contratos de varias páginas (aprox. 4-5 al imprimir, según el formato).
    if (
        $tipoTarifa === '' ||
        mb_strlen($tipoTarifa, 'UTF-8') > 100 ||
        $condiciones === '' ||
        mb_strlen($condiciones, 'UTF-8') > 10000 ||
        mb_strlen($observaciones, 'UTF-8') > 5000 ||
        $estadoCodigo === null
    ) {
        throw new DetalleAlquilerApiException('Revisa el tipo de tarifa, las condiciones, las observaciones y el estado del contrato.', 422);
    }

    $fechaGeneracion = validarFechaDetalleAlquiler($fechaGeneracionTexto);
    $fechaInicio = validarFechaDetalleAlquiler($fechaInicioTexto);
    $fechaFin = validarFechaDetalleAlquiler($fechaFinTexto);
    if (!$fechaGeneracion || !$fechaInicio || !$fechaFin) {
        throw new DetalleAlquilerApiException('Las fechas del contrato no tienen un formato válido.', 422);
    }
    if ($fechaFin <= $fechaInicio) {
        throw new DetalleAlquilerApiException('La fecha de fin debe ser posterior a la fecha de inicio.', 422);
    }

    $valorTarifa = validarNumeroNoNegativoDetalle($valorTarifaTexto, 'El valor de tarifa');
    $valorTotal = validarNumeroNoNegativoDetalle($valorTotalTexto, 'El valor total');
    $kilometrajeInicial = $kilometrajeInicialTexto === ''
        ? null
        : validarNumeroNoNegativoDetalle($kilometrajeInicialTexto, 'El kilometraje inicial', true);
    $kilometrajeFinal = $kilometrajeFinalTexto === ''
        ? null
        : validarNumeroNoNegativoDetalle($kilometrajeFinalTexto, 'El kilometraje final', true);

    if (
        $kilometrajeInicial !== null &&
        $kilometrajeFinal !== null &&
        $kilometrajeFinal < $kilometrajeInicial
    ) {
        throw new DetalleAlquilerApiException('El kilometraje final no puede ser menor que el inicial.', 422);
    }

    $archivo = $_FILES['archivo_contrato'] ?? [];
    validarArchivoPdfDetalle($archivo);

    // Sincroniza primero el vencimiento; así también se pueden completar contratos
    // asociados a alquileres que ya terminaron.
    $conexion->beginTransaction();
    sincronizarAlquileresVencidos(
        $conexion,
        new DateTimeImmutable('now', new DateTimeZone('America/Bogota'))
    );
    $conexion->commit();

    // La transacción bloquea el alquiler, evita duplicados y mantiene coordinados BD y archivo PDF.
    $conexion->beginTransaction();

    $consultaAlquiler = $conexion->prepare(
        'SELECT a.id_alquiler, a.estado, a.id_usuario
         FROM alquileres AS a
         WHERE a.id_alquiler = :id_alquiler
         FOR UPDATE'
    );
    $consultaAlquiler->execute([':id_alquiler' => $idAlquiler]);
    $alquiler = $consultaAlquiler->fetch(PDO::FETCH_ASSOC);
    if (!$alquiler) {
        throw new DetalleAlquilerApiException('No se encontró el alquiler seleccionado.', 404);
    }
    if (!in_array((int) $alquiler['estado'], [2, 4], true)) {
        throw new DetalleAlquilerApiException('Solo se puede generar un contrato para un alquiler activo o completado. Los alquileres cancelados no admiten contratos.', 409);
    }

    if ((int) $alquiler['estado'] === 4) {
        $estadoCodigo = 2;
    }

    $consultaExistente = $conexion->prepare(
        'SELECT id_contrato, archivo_contrato
         FROM contratos
         WHERE id_alquiler = :id_alquiler
         LIMIT 1
         FOR UPDATE'
    );
    $consultaExistente->execute([':id_alquiler' => $idAlquiler]);
    $existente = $consultaExistente->fetch(PDO::FETCH_ASSOC) ?: null;

    $consultaNumero = $existente
        ? $conexion->prepare(
            'SELECT id_contrato
             FROM contratos
             WHERE numero_contrato = :numero_contrato
               AND id_contrato <> :id_contrato
             LIMIT 1'
        )
        : $conexion->prepare(
            'SELECT id_contrato
             FROM contratos
             WHERE numero_contrato = :numero_contrato
             LIMIT 1'
        );
    $parametrosNumero = [':numero_contrato' => $numeroContrato];
    if ($existente) {
        $parametrosNumero[':id_contrato'] = $existente['id_contrato'];
    }
    $consultaNumero->execute($parametrosNumero);
    if ($consultaNumero->fetchColumn() !== false) {
        throw new DetalleAlquilerApiException('Ya existe otro contrato con ese número. Utiliza un número diferente.', 409);
    }

    $archivoGuardado = $existente['archivo_contrato'] ?? null;
    if (($archivo['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $directorio = directorioPdfDetalleAlquiler();
        if (!is_dir($directorio) && !mkdir($directorio, 0750, true) && !is_dir($directorio)) {
            throw new DetalleAlquilerApiException('No se pudo preparar el almacenamiento privado de los contratos.', 500);
        }

        $archivoGuardado = bin2hex(random_bytes(16)) . '.pdf';
        $archivoNuevo = $directorio . DIRECTORY_SEPARATOR . $archivoGuardado;
        if (!move_uploaded_file((string) $archivo['tmp_name'], $archivoNuevo)) {
            $archivoNuevo = null;
            throw new DetalleAlquilerApiException('No se pudo guardar el archivo PDF.', 500);
        }
    }

    $parametros = [
        ':numero_contrato' => $numeroContrato,
        ':fecha_generacion' => $fechaGeneracion->format('Y-m-d H:i:s'),
        ':fecha_inicio' => $fechaInicio->format('Y-m-d H:i:s'),
        ':fecha_fin' => $fechaFin->format('Y-m-d H:i:s'),
        ':tipo_tarifa' => $tipoTarifa,
        ':valor_tarifa' => $valorTarifa,
        ':kilometraje_inicial' => $kilometrajeInicial,
        ':kilometraje_final' => $kilometrajeFinal,
        ':valor_total' => $valorTotal,
        ':condiciones' => $condiciones,
        ':observaciones' => $observaciones,
        ':archivo_contrato' => $archivoGuardado,
        ':estado' => $estadoCodigo
    ];

    if ($existente) {
        $parametros[':id_contrato'] = $existente['id_contrato'];
        $guardar = $conexion->prepare(
            'UPDATE contratos
             SET numero_contrato = :numero_contrato,
                 fecha_generacion = :fecha_generacion,
                 fecha_inicio = :fecha_inicio,
                 fecha_fin = :fecha_fin,
                 tipo_tarifa = :tipo_tarifa,
                 valor_tarifa = :valor_tarifa,
                 kilometraje_inicial = :kilometraje_inicial,
                 kilometraje_final = :kilometraje_final,
                 valor_total = :valor_total,
                 condiciones = :condiciones,
                 observaciones = :observaciones,
                 archivo_contrato = :archivo_contrato,
                 estado = :estado
             WHERE id_contrato = :id_contrato'
        );
        $guardar->execute($parametros);
        $idContrato = (int) $existente['id_contrato'];
    } else {
        $parametros[':id_alquiler'] = $idAlquiler;
        $parametros[':id_usuario'] = $alquiler['id_usuario'];
        $guardar = $conexion->prepare(
            'INSERT INTO contratos (
                numero_contrato, fecha_generacion, fecha_inicio, fecha_fin,
                tipo_tarifa, valor_tarifa, kilometraje_inicial, kilometraje_final,
                valor_total, condiciones, observaciones, archivo_contrato,
                estado, id_alquiler, id_usuario
             ) VALUES (
                :numero_contrato, :fecha_generacion, :fecha_inicio, :fecha_fin,
                :tipo_tarifa, :valor_tarifa, :kilometraje_inicial, :kilometraje_final,
                :valor_total, :condiciones, :observaciones, :archivo_contrato,
                :estado, :id_alquiler, :id_usuario
             )'
        );
        $guardar->execute($parametros);
        $idContrato = (int) $conexion->lastInsertId();
    }

    $conexion->commit();
    $archivoNuevo = null;

    $archivoAnterior = $existente['archivo_contrato'] ?? null;
    if (
        $archivoAnterior &&
        $archivoAnterior !== $archivoGuardado &&
        preg_match('/\A[a-f0-9]{32}\.pdf\z/', $archivoAnterior)
    ) {
        $rutaAnterior = directorioPdfDetalleAlquiler() . DIRECTORY_SEPARATOR . $archivoAnterior;
        if (is_file($rutaAnterior) && !unlink($rutaAnterior)) {
            error_log('No se pudo retirar el PDF anterior del contrato ' . $idContrato . '.');
        }
    }

    $contratoGuardado = consultarContratoDetalle($conexion, $idContrato);
    if (!$contratoGuardado) {
        throw new DetalleAlquilerApiException('El contrato se guardó, pero no se pudo volver a consultar.', 500);
    }

    responderDetalleAlquiler([
        'ok' => true,
        'mensaje' => $existente ? 'Los datos del contrato se actualizaron.' : 'El contrato se creó correctamente.',
        'contrato' => $contratoGuardado
    ]);
} catch (DetalleAlquilerApiException $error) {
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }
    if ($archivoNuevo && is_file($archivoNuevo) && !unlink($archivoNuevo)) {
        error_log('No se pudo retirar un PDF temporal tras fallar el guardado.');
    }
    responderDetalleAlquiler(['ok' => false, 'mensaje' => $error->getMessage()], $error->httpStatus);
} catch (PDOException $error) {
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }
    if ($archivoNuevo && is_file($archivoNuevo) && !unlink($archivoNuevo)) {
        error_log('No se pudo retirar un PDF temporal tras fallar el guardado.');
    }
    error_log('Error al gestionar contratos RentCars: ' . $error->getMessage());
    responderDetalleAlquiler(['ok' => false, 'mensaje' => 'No fue posible guardar o consultar los contratos. Inténtalo de nuevo.'], 500);
} catch (Throwable $error) {
    if ($conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }
    if ($archivoNuevo && is_file($archivoNuevo) && !unlink($archivoNuevo)) {
        error_log('No se pudo retirar un PDF temporal tras fallar el guardado.');
    }
    error_log('Error inesperado en contratos RentCars: ' . $error->getMessage());
    responderDetalleAlquiler(['ok' => false, 'mensaje' => 'Ocurrió un error interno. Inténtalo de nuevo.'], 500);
}
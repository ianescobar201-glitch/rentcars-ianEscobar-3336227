<?php

declare(strict_types=1);

session_start();

// Este controlador responde en JSON; evita que el navegador o un proxy almacenen datos desactualizados.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

final class VehiculosApiException extends RuntimeException
{
    public int $httpStatus;

    public function __construct(string $message, int $httpStatus)
    {
        parent::__construct($message);
        $this->httpStatus = $httpStatus;
    }
}

function responderVehiculos(array $respuesta, int $estado = 200): void
{
    http_response_code($estado);
    echo json_encode($respuesta, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

// Lee campos del formulario como texto y aplica el control de obligatoriedad antes de validarlos.
function leerTexto(array $origen, string $campo, bool $obligatorio = true): string
{
    $valor = $origen[$campo] ?? '';

    if (!is_string($valor)) {
        throw new VehiculosApiException('La solicitud contiene un campo inválido.', 400);
    }

    $valor = trim($valor);

    if ($obligatorio && $valor === '') {
        throw new VehiculosApiException('Completa todos los campos obligatorios.', 422);
    }

    return $valor;
}

function validarLongitud(string $valor, int $maximo): bool
{
    return mb_strlen($valor, 'UTF-8') <= $maximo;
}

// Convierte una ruta guardada en la base de datos en una ruta relativa segura para la pantalla.
function rutaFoto(string $nombre): string
{
    if (str_starts_with($nombre, 'Assets/Images/')) {
        $nombre = substr($nombre, strlen('Assets/Images/'));
    }

    if (!preg_match('/\A[a-f0-9]{32}\.(?:jpg|png|webp)\z/', $nombre)) {
        return '';
    }

    return '../../Assets/Images/' . $nombre;
}

function rutaFisicaFoto(string $nombre): ?string
{
    if (str_starts_with($nombre, 'Assets/Images/')) {
        $nombre = substr($nombre, strlen('Assets/Images/'));
    }

    if (!preg_match('/\A[a-f0-9]{32}\.(?:jpg|png|webp)\z/', $nombre)) {
        return null;
    }

    return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR
        . 'Assets' . DIRECTORY_SEPARATOR . 'Images' . DIRECTORY_SEPARATOR . $nombre;
}

// Comprueba el contenido real del archivo; no confía únicamente en el nombre o MIME enviados por el navegador.
function recibirFoto(?array $archivo): ?array
{
    if ($archivo === null || ($archivo['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return null;
    }

    if (
        !isset($archivo['error'], $archivo['size'], $archivo['tmp_name']) ||
        !is_int($archivo['error']) ||
        $archivo['error'] !== UPLOAD_ERR_OK ||
        !is_int($archivo['size']) ||
        $archivo['size'] < 1 ||
        $archivo['size'] > 2 * 1024 * 1024 ||
        !is_string($archivo['tmp_name']) ||
        !is_uploaded_file($archivo['tmp_name'])
    ) {
        throw new VehiculosApiException('La foto debe ser una imagen de máximo 2 MB.', 422);
    }

    $informacionImagen = @getimagesize($archivo['tmp_name']);
    $detector = new finfo(FILEINFO_MIME_TYPE);
    $mime = $detector->file($archivo['tmp_name']);
    $formatos = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp'
    ];

    if (
        $informacionImagen === false ||
        !isset($formatos[$mime]) ||
        ($informacionImagen['mime'] ?? '') !== $mime
    ) {
        throw new VehiculosApiException('La foto debe estar en formato JPG, PNG o WebP.', 422);
    }

    $directorio = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR
        . 'Assets' . DIRECTORY_SEPARATOR . 'Images';

    $nombre = bin2hex(random_bytes(16)) . '.' . $formatos[$mime];
    $destino = $directorio . DIRECTORY_SEPARATOR . $nombre;

    if (!move_uploaded_file($archivo['tmp_name'], $destino)) {
        throw new RuntimeException('No fue posible guardar la foto.');
    }

    return ['nombre' => 'Assets/Images/' . $nombre, 'ruta' => $destino];
}

// Borra una foto anterior sólo si su ruta coincide con el formato generado por este sistema.
function eliminarFotoAnterior(?string $nombre): void
{
    if ($nombre === null || $nombre === '') {
        return;
    }

    $ruta = rutaFisicaFoto($nombre);

    if ($ruta !== null && is_file($ruta) && !unlink($ruta)) {
        error_log('RentCars: no se pudo eliminar una foto reemplazada: ' . $nombre);
    }
}

$archivoNuevo = null;

try {
    $usuarioSesion = $_SESSION['usuario'] ?? null;

    // Verifica que la sesión tenga un identificador de usuario válido antes de consultar la base de datos.
    if (
        !is_array($usuarioSesion) ||
        !isset($usuarioSesion['id_usuario']) ||
        (!is_int($usuarioSesion['id_usuario']) && !is_string($usuarioSesion['id_usuario'])) ||
        !ctype_digit((string) $usuarioSesion['id_usuario'])
    ) {
        responderVehiculos(['ok' => false, 'mensaje' => 'Inicia sesión para continuar.'], 401);
    }

    define('RENTCARS_ALQUILER_HELPERS_ONLY', true);
    require_once __DIR__ . '/../alquileres/nuevo.php';
    require_once __DIR__ . '/../../config/database.php';

    $consultaUsuario = $conexion->prepare(
        'SELECT rol, estado FROM usuarios WHERE id_usuario = :id_usuario LIMIT 1'
    );
    $consultaUsuario->execute([':id_usuario' => $usuarioSesion['id_usuario']]);
    $usuario = $consultaUsuario->fetch(PDO::FETCH_ASSOC);

    // Una cuenta eliminada o desactivada ya no debe conservar acceso mediante una sesión antigua.
    if (!$usuario || (int) $usuario['estado'] !== 1) {
        $_SESSION = [];
        session_destroy();
        responderVehiculos(['ok' => false, 'mensaje' => 'La sesión ya no está activa.'], 401);
    }

    if (!in_array($usuario['rol'], ['empleado', 'cliente'], true)) {
        responderVehiculos(['ok' => false, 'mensaje' => 'No tienes permiso para consultar vehículos.'], 403);
    }

    $metodo = $_SERVER['REQUEST_METHOD'] ?? '';

    if ($metodo === 'GET') {
        if (($_GET['action'] ?? '') !== 'list') {
            responderVehiculos(['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'], 400);
        }

        if (!isset($_SESSION['csrf_vehiculos'])) {
            $_SESSION['csrf_vehiculos'] = bin2hex(random_bytes(32));
        }

        // Sincroniza vencimientos para que el listado no conserve alquileres ya terminados.
        $conexion->beginTransaction();
        sincronizarAlquileresVencidos(
            $conexion,
            new DateTimeImmutable('now', new DateTimeZone('America/Bogota'))
        );
        $conexion->commit();

        // El listado inicial alimenta la tabla del empleado y los selectores de categorías.
        $categorias = $conexion->query(
            'SELECT id_categoria, nombre, `descripción` AS descripcion, estado
             FROM categorias_vehiculo
             ORDER BY nombre'
        )->fetchAll(PDO::FETCH_ASSOC);

        $ahora = new DateTimeImmutable('now', new DateTimeZone('America/Bogota'));
        $consultaVehiculos = $conexion->prepare(
            'SELECT v.id_vehiculo, v.placa, v.marca, v.modelo, v.`año` AS anio,
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
             ORDER BY v.id_vehiculo DESC'
        );
        $consultaVehiculos->execute([
            ':ahora' => $ahora->format('Y-m-d H:i:s')
        ]);
        $vehiculos = $consultaVehiculos->fetchAll(PDO::FETCH_ASSOC);

        $categorias = array_map(
            static function (array $categoria): array {
                return [
                    'id_categoria' => (string) $categoria['id_categoria'],
                    'nombre' => $categoria['nombre'],
                    'descripcion' => $categoria['descripcion'],
                    'estado' => (int) $categoria['estado'] === 1 ? 'Activa' : 'Inactiva'
                ];
            },
            $categorias
        );

        $vehiculos = array_map(
            static function (array $vehiculo): array {
                $fotoGuardada = is_string($vehiculo['foto_vehiculo'])
                    ? $vehiculo['foto_vehiculo']
                    : '';
                $estadoOperativo = $vehiculo['estado'] ?? '';
                $tieneReservaActiva = (int) $vehiculo['reserva_pendiente_activa'] === 1;
                $estadoMostrado = $estadoOperativo;

                if (
                    $estadoOperativo === 'Disponible' &&
                    $tieneReservaActiva
                ) {
                    $estadoMostrado = 'Reservado';
                }

                return [
                    'id_vehiculo' => (string) $vehiculo['id_vehiculo'],
                    'placa' => $vehiculo['placa'] ?? '',
                    'marca' => $vehiculo['marca'] ?? '',
                    'modelo' => $vehiculo['modelo'] ?? '',
                    'anio' => $vehiculo['anio'] ?? '',
                    'color' => $vehiculo['color'] ?? '',
                    'combustible' => $vehiculo['combustible'] ?? '',
                    'transmision' => $vehiculo['transmision'] ?? '',
                    'capacidad' => $vehiculo['capacidad'] ?? '',
                    'kilometraje' => $vehiculo['kilometraje'] ?? 0,
                    // "estado" conserva el valor editable; "estado_mostrado"
                    // agrega la ocupación derivada sin modificar la base de datos.
                    'estado' => $estadoOperativo,
                    'estado_mostrado' => $estadoMostrado,
                    'foto' => rutaFoto($fotoGuardada),
                    'id_categoria' => (string) $vehiculo['id_categoria']
                ];
            },
            $vehiculos
        );

        responderVehiculos([
            'ok' => true,
            'csrf_token' => $_SESSION['csrf_vehiculos'],
            'categorias' => $categorias,
            'vehiculos' => $vehiculos
        ]);
    }

    if ($metodo !== 'POST') {
        header('Allow: GET, POST');
        responderVehiculos(['ok' => false, 'mensaje' => 'Método no permitido.'], 405);
    }

    if ($usuario['rol'] !== 'empleado') {
        responderVehiculos(['ok' => false, 'mensaje' => 'Solo un empleado puede modificar vehículos.'], 403);
    }

    // El token CSRF confirma que el cambio proviene de la sesión legítima de la aplicación.
    $token = leerTexto($_POST, 'csrf_token');

    if (
        !isset($_SESSION['csrf_vehiculos']) ||
        !hash_equals($_SESSION['csrf_vehiculos'], $token)
    ) {
        responderVehiculos(['ok' => false, 'mensaje' => 'La solicitud venció. Actualiza la página e inténtalo de nuevo.'], 403);
    }

    $accion = leerTexto($_POST, 'action');

    if ($accion === 'category_save') {
        $id = leerTexto($_POST, 'id_categoria', false);
        $nombre = leerTexto($_POST, 'nombre');
        $descripcion = leerTexto($_POST, 'descripcion', false);
        $estado = leerTexto($_POST, 'estado');

        if (
            !validarLongitud($nombre, 100) ||
            !validarLongitud($descripcion, 250) ||
            !in_array($estado, ['Activa', 'Inactiva'], true)
        ) {
            throw new VehiculosApiException('Revisa el nombre, la descripción y el estado de la categoría.', 422);
        }

        // Un ID vacío crea una categoría; con ID se actualizan sus datos existentes.
        if ($id === '') {
            $consulta = $conexion->prepare(
                'INSERT INTO categorias_vehiculo (`nombre`, `descripción`, `estado`)
                 VALUES (:nombre, :descripcion, :estado)'
            );
            $consulta->execute([
                ':nombre' => $nombre,
                ':descripcion' => $descripcion,
                ':estado' => $estado === 'Activa' ? 1 : 0
            ]);
        } else {
            if (!ctype_digit($id) || (int) $id < 1) {
                throw new VehiculosApiException('La categoría seleccionada no es válida.', 422);
            }

            $consulta = $conexion->prepare(
                'UPDATE categorias_vehiculo
                 SET nombre = :nombre, `descripción` = :descripcion, estado = :estado
                 WHERE id_categoria = :id_categoria'
            );
            $consulta->execute([
                ':nombre' => $nombre,
                ':descripcion' => $descripcion,
                ':estado' => $estado === 'Activa' ? 1 : 0,
                ':id_categoria' => $id
            ]);

            if ($consulta->rowCount() === 0) {
                $existe = $conexion->prepare(
                    'SELECT 1 FROM categorias_vehiculo WHERE id_categoria = :id_categoria'
                );
                $existe->execute([':id_categoria' => $id]);

                if (!$existe->fetchColumn()) {
                    throw new VehiculosApiException('La categoría ya no existe.', 404);
                }
            }
        }

        responderVehiculos(['ok' => true, 'mensaje' => 'Categoría guardada correctamente.']);
    }

    if ($accion === 'category_delete') {
        $id = leerTexto($_POST, 'id_categoria');

        if (!ctype_digit($id) || (int) $id < 1) {
            throw new VehiculosApiException('La categoría seleccionada no es válida.', 422);
        }

        // No se elimina una categoría que tenga vehículos asociados para preservar sus relaciones.
        $consulta = $conexion->prepare(
            'SELECT COUNT(*) FROM vehiculos WHERE id_categoria = :id_categoria'
        );
        $consulta->execute([':id_categoria' => $id]);

        if ((int) $consulta->fetchColumn() > 0) {
            throw new VehiculosApiException(
                'No puedes eliminar una categoría que tenga vehículos asignados.',
                409
            );
        }

        $consulta = $conexion->prepare(
            'DELETE FROM categorias_vehiculo WHERE id_categoria = :id_categoria'
        );
        $consulta->execute([':id_categoria' => $id]);

        if ($consulta->rowCount() === 0) {
            throw new VehiculosApiException('La categoría ya no existe.', 404);
        }

        responderVehiculos(['ok' => true, 'mensaje' => 'Categoría eliminada correctamente.']);
    }

    if ($accion === 'vehicle_delete') {
        $id = leerTexto($_POST, 'id_vehiculo');

        if (!ctype_digit($id) || (int) $id < 1) {
            throw new VehiculosApiException('El vehículo seleccionado no es válido.', 422);
        }

        // La baja es lógica: conserva el registro histórico y sus posibles referencias.
        $consulta = $conexion->prepare(
            'UPDATE vehiculos SET estado_vehiculo = :estado
             WHERE id_vehiculo = :id_vehiculo'
        );
        $consulta->execute([':estado' => 'Inactivo', ':id_vehiculo' => $id]);

        if ($consulta->rowCount() === 0) {
            $existe = $conexion->prepare(
                'SELECT 1 FROM vehiculos WHERE id_vehiculo = :id_vehiculo'
            );
            $existe->execute([':id_vehiculo' => $id]);

            if (!$existe->fetchColumn()) {
                throw new VehiculosApiException('El vehículo ya no existe.', 404);
            }
        }

        responderVehiculos([
            'ok' => true,
            'mensaje' => 'Vehículo desactivado; se conserva en el historial.'
        ]);
    }

    if ($accion === 'vehicle_save') {
        $id = leerTexto($_POST, 'id_vehiculo', false);
        $placa = strtoupper(leerTexto($_POST, 'placa'));
        $marca = leerTexto($_POST, 'marca');
        $modelo = leerTexto($_POST, 'modelo');
        $anio = leerTexto($_POST, 'anio');
        $color = leerTexto($_POST, 'color');
        $combustible = leerTexto($_POST, 'combustible');
        $transmision = leerTexto($_POST, 'transmision');
        $capacidad = leerTexto($_POST, 'capacidad');
        $kilometraje = leerTexto($_POST, 'kilometraje');
        $estado = leerTexto($_POST, 'estado');
        $idCategoria = leerTexto($_POST, 'id_categoria');
        $valorQuitarFoto = leerTexto($_POST, 'remove_photo', false);

        if (!in_array($valorQuitarFoto, ['', '0', '1'], true)) {
            throw new VehiculosApiException('La opción de foto no es válida.', 422);
        }

        $quitarFoto = $valorQuitarFoto === '1';

        // Valida rangos y opciones en el servidor; las validaciones del formulario no sustituyen estos controles.
        $anioNumerico = filter_var($anio, FILTER_VALIDATE_INT);
        $capacidadNumerica = filter_var($capacidad, FILTER_VALIDATE_INT);
        $kilometrajeNumerico = filter_var($kilometraje, FILTER_VALIDATE_INT);
        $anioMaximo = (int) date('Y') + 1;
        $combustibles = ['Gasolina', 'Diésel', 'Gas (GLP/GNV)', 'Eléctrico', 'Híbrido'];
        $transmisiones = ['Manual', 'Automática'];
        $estados = ['Disponible', 'Alquilado', 'En mantenimiento', 'Inactivo'];

        if (
            !preg_match('/\A[A-Z0-9-]{5,10}\z/', $placa) ||
            !validarLongitud($marca, 50) ||
            !validarLongitud($modelo, 50) ||
            !validarLongitud($color, 50) ||
            $anioNumerico === false ||
            $anioNumerico < 1900 ||
            $anioNumerico > $anioMaximo ||
            !in_array($combustible, $combustibles, true) ||
            !in_array($transmision, $transmisiones, true) ||
            $capacidadNumerica === false ||
            $capacidadNumerica < 1 ||
            $capacidadNumerica > 50 ||
            $kilometrajeNumerico === false ||
            $kilometrajeNumerico < 0 ||
            $kilometrajeNumerico > 2147483647 ||
            !in_array($estado, $estados, true) ||
            !ctype_digit($idCategoria) ||
            (int) $idCategoria < 1
        ) {
            throw new VehiculosApiException('Revisa los datos del vehículo; hay valores inválidos o fuera de rango.', 422);
        }

        $vehiculoAnterior = null;

        if ($id !== '') {
            if (!ctype_digit($id) || (int) $id < 1) {
                throw new VehiculosApiException('El vehículo seleccionado no es válido.', 422);
            }

            $consulta = $conexion->prepare(
                'SELECT id_categoria, foto_vehiculo
                 FROM vehiculos WHERE id_vehiculo = :id_vehiculo'
            );
            $consulta->execute([':id_vehiculo' => $id]);
            $vehiculoAnterior = $consulta->fetch(PDO::FETCH_ASSOC);

            if (!$vehiculoAnterior) {
                throw new VehiculosApiException('El vehículo ya no existe.', 404);
            }
        }

        $consultaCategoria = $conexion->prepare(
            'SELECT estado FROM categorias_vehiculo WHERE id_categoria = :id_categoria'
        );
        $consultaCategoria->execute([':id_categoria' => $idCategoria]);
        $estadoCategoria = $consultaCategoria->fetchColumn();

        if (
            $estadoCategoria === false ||
            ((int) $estadoCategoria !== 1 &&
                (!$vehiculoAnterior ||
                    (string) $vehiculoAnterior['id_categoria'] !== $idCategoria))
        ) {
            throw new VehiculosApiException('Selecciona una categoría activa.', 422);
        }

        $consultaPlaca = $conexion->prepare(
            'SELECT id_vehiculo FROM vehiculos WHERE placa = :placa LIMIT 1'
        );
        $consultaPlaca->execute([':placa' => $placa]);
        $idConPlaca = $consultaPlaca->fetchColumn();

        if ($idConPlaca !== false && (string) $idConPlaca !== $id) {
            throw new VehiculosApiException('Esta placa ya está registrada.', 409);
        }

        // Conserva la foto actual si no se carga otra ni se solicita quitarla.
        $fotoAnterior = $vehiculoAnterior['foto_vehiculo'] ?? null;
        $fotoNueva = recibirFoto($_FILES['foto_vehiculo'] ?? null);
        $archivoNuevo = $fotoNueva['ruta'] ?? null;
        $nombreFoto = $fotoNueva['nombre'] ?? (
            $quitarFoto ? null : $fotoAnterior
        );

        // Usa consultas preparadas tanto para crear como para actualizar el vehículo.
        if ($id === '') {
            $consulta = $conexion->prepare(
                'INSERT INTO vehiculos
                    (placa, marca, modelo, `año`, color, combustible, `transmisión`,
                     capacidad, kilometraje_actual, estado_vehiculo, foto_vehiculo, id_categoria)
                 VALUES
                    (:placa, :marca, :modelo, :anio, :color, :combustible, :transmision,
                     :capacidad, :kilometraje, :estado, :foto, :id_categoria)'
            );
        } else {
            $consulta = $conexion->prepare(
                'UPDATE vehiculos SET
                    placa = :placa, marca = :marca, modelo = :modelo, `año` = :anio,
                    color = :color, combustible = :combustible, `transmisión` = :transmision,
                    capacidad = :capacidad, kilometraje_actual = :kilometraje,
                    estado_vehiculo = :estado, foto_vehiculo = :foto,
                    id_categoria = :id_categoria
                 WHERE id_vehiculo = :id_vehiculo'
            );
        }

        $parametros = [
            ':placa' => $placa,
            ':marca' => $marca,
            ':modelo' => $modelo,
            ':anio' => (string) $anioNumerico,
            ':color' => $color,
            ':combustible' => $combustible,
            ':transmision' => $transmision,
            ':capacidad' => (string) $capacidadNumerica,
            ':kilometraje' => $kilometrajeNumerico,
            ':estado' => $estado,
            ':foto' => $nombreFoto,
            ':id_categoria' => $idCategoria
        ];

        if ($id !== '') {
            $parametros[':id_vehiculo'] = $id;
        }

        $consulta->execute($parametros);

        if ($fotoNueva !== null && $fotoAnterior !== null) {
            eliminarFotoAnterior((string) $fotoAnterior);
        } elseif ($quitarFoto && $fotoAnterior !== null) {
            eliminarFotoAnterior((string) $fotoAnterior);
        }

        $archivoNuevo = null;

        responderVehiculos([
            'ok' => true,
            'mensaje' => $id === ''
                ? 'Vehículo registrado correctamente.'
                : 'Vehículo actualizado correctamente.'
        ]);
    }

    responderVehiculos(['ok' => false, 'mensaje' => 'La acción solicitada no es válida.'], 400);
} catch (VehiculosApiException $error) {
    // Si la operación falla después de subir una foto, elimina el archivo nuevo para no dejarlo huérfano.
    if ($archivoNuevo !== null && is_file($archivoNuevo) && !unlink($archivoNuevo)) {
        error_log('RentCars: no se pudo limpiar una foto de una operación fallida.');
    }

    responderVehiculos(['ok' => false, 'mensaje' => $error->getMessage()], $error->httpStatus);
} catch (PDOException $error) {
    if (isset($conexion) && $conexion instanceof PDO && $conexion->inTransaction()) {
        $conexion->rollBack();
    }
    if ($archivoNuevo !== null && is_file($archivoNuevo) && !unlink($archivoNuevo)) {
        error_log('RentCars: no se pudo limpiar una foto de una operación fallida.');
    }

    // Guarda el detalle técnico en el servidor y devuelve al navegador un mensaje sin información interna.
    error_log('Error en el módulo de vehículos RentCars: ' . $error->getMessage());
    $codigoMysql = (int) ($error->errorInfo[1] ?? 0);

    if ($codigoMysql === 1062) {
        responderVehiculos(['ok' => false, 'mensaje' => 'La placa o el nombre de categoría ya están registrados.'], 409);
    }

    if ($codigoMysql === 1451 || $codigoMysql === 1452) {
        responderVehiculos(['ok' => false, 'mensaje' => 'No se puede completar la operación porque el registro está relacionado con otros datos.'], 409);
    }

    responderVehiculos(['ok' => false, 'mensaje' => 'No fue posible guardar los cambios. Inténtalo de nuevo.'], 500);
} catch (Throwable $error) {
    if ($archivoNuevo !== null && is_file($archivoNuevo) && !unlink($archivoNuevo)) {
        error_log('RentCars: no se pudo limpiar una foto de una operación fallida.');
    }

    error_log('Error inesperado en el módulo de vehículos RentCars: ' . $error->getMessage());
    responderVehiculos(['ok' => false, 'mensaje' => 'Ocurrió un error interno. Inténtalo de nuevo.'], 500);
}

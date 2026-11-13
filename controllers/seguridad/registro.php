<?php

require_once __DIR__ . '/../../config/database.php';

// Solo permitir solicitudes POST.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Location: ../../views/seguridad/registro.html');
    exit;
}

// Obtener los datos del formulario.
$nombre = $_POST['nombre'] ?? '';
$apellido = $_POST['apellido'] ?? '';
$correo = $_POST['correo'] ?? '';
$password = $_POST['password'] ?? '';
$confirmPassword = $_POST['confirm_password'] ?? '';

// Validar que los campos sean cadenas de texto.
if (
    !is_string($nombre) ||
    !is_string($apellido) ||
    !is_string($correo) ||
    !is_string($password) ||
    !is_string($confirmPassword)
) {
    header('Location: ../../views/seguridad/registro.html?error=datos');
    exit;
}

// Limpiar los campos de texto.
$nombre = trim($nombre);
$apellido = trim($apellido);
$correo = trim($correo);

// Validar campos obligatorios.
if (
    $nombre === '' ||
    $apellido === '' ||
    $correo === '' ||
    $password === '' ||
    $confirmPassword === ''
) {
    header('Location: ../../views/seguridad/registro.html?error=campos');
    exit;
}

// Validar el formato del correo.
if (!filter_var($correo, FILTER_VALIDATE_EMAIL)) {
    header('Location: ../../views/seguridad/registro.html?error=correo_invalido');
    exit;
}

// Validar la longitud mínima de la contraseña.
if (strlen($password) < 6) {
    header('Location: ../../views/seguridad/registro.html?error=password');
    exit;
}

// Comprobar que las contraseñas coincidan.
if ($password !== $confirmPassword) {
    header('Location: ../../views/seguridad/registro.html?error=password_diferente');
    exit;
}

try {
    // Comprobar si el correo ya está registrado.
    $consulta = $conexion->prepare(
        'SELECT id_usuario
         FROM usuarios
         WHERE correo = :correo
         LIMIT 1'
    );

    $consulta->execute([
        ':correo' => $correo
    ]);

    if ($consulta->fetch(PDO::FETCH_ASSOC)) {
        header('Location: ../../views/seguridad/registro.html?error=correo_existente');
        exit;
    }

    // Encriptar la contraseña antes de guardarla.
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);

    // Asignar los valores de forma segura desde el servidor.
    $rol = 'cliente';
    $estado = 1;

    // Insertar el nuevo usuario.
    $sql = 'INSERT INTO usuarios
            (nombre, apellido, correo, `password`, rol, estado)
            VALUES
            (:nombre, :apellido, :correo, :password, :rol, :estado)';

    $insertar = $conexion->prepare($sql);

    $insertar->execute([
        ':nombre' => $nombre,
        ':apellido' => $apellido,
        ':correo' => $correo,
        ':password' => $passwordHash,
        ':rol' => $rol,
        ':estado' => $estado
    ]);

    // Registro exitoso: enviar al inicio de sesión.
    header('Location: ../../views/seguridad/login.html?registro=exitoso');
    exit;
} catch (PDOException $e) {

    // Guardar los detalles técnicos en el registro de errores.
    error_log('Error al registrar usuario en RentCars: ' . $e->getMessage());

    // No mostrar detalles internos de la base de datos al usuario.
    header('Location: ../../views/seguridad/registro.html?error=registro');
    exit;
}

export default function DataDeletion() {
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px', fontFamily: 'sans-serif', color: '#222' }}>
      <h1>Solicitud de Eliminación de Datos</h1>
      <p><strong>Happy Pets Family</strong><br />
      Medellín, Colombia<br />
      Contacto: <a href="mailto:happypets2021@outlook.es">happypets2021@outlook.es</a></p>

      <h2>¿Cómo solicitar la eliminación de sus datos?</h2>
      <p>En Happy Pets Family respetamos su derecho a la eliminación de datos personales conforme a la Ley 1581 de 2012 de Colombia.</p>

      <p>Para solicitar la eliminación de sus datos personales (nombre, número de teléfono, nombre de mascota), envíe un correo electrónico a:</p>

      <p style={{ fontSize: '1.2rem' }}>
        <strong><a href="mailto:happypets2021@outlook.es">happypets2021@outlook.es</a></strong>
      </p>

      <p>Incluya en su solicitud:</p>
      <ul>
        <li>Asunto: <strong>Solicitud de eliminación de datos</strong></li>
        <li>Su nombre completo</li>
        <li>Número de teléfono asociado</li>
      </ul>

      <h2>Tiempo de respuesta</h2>
      <p>Procesaremos su solicitud en un plazo máximo de <strong>15 días hábiles</strong> a partir de la recepción del correo. Le confirmaremos por email cuando sus datos hayan sido eliminados.</p>

      <h2>Datos que se eliminarán</h2>
      <ul>
        <li>Nombre completo</li>
        <li>Número de teléfono</li>
        <li>Nombre de mascota</li>
        <li>Historial de conversaciones asociado</li>
      </ul>

      <p>Para más información, consulte nuestra <a href="/privacy-policy">Política de Privacidad</a>.</p>
    </main>
  )
}

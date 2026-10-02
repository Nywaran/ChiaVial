export default function Politica() {
  return (
    <article className="tarjeta" style={{ maxWidth: 820 }}>
      <h1>Política de tratamiento de datos personales</h1>
      <p className="aviso aviso-info">Texto base para el proyecto universitario. Antes de un uso real debe revisarlo el área jurídica de la entidad responsable.</p>
      <h2>Responsable</h2>
      <p>ChíaVial, plataforma de seguridad vial del municipio de Chía (proyecto académico).</p>
      <h2>Datos que recolectamos</h2>
      <ul>
        <li>Nombre y correo electrónico, para crear tu cuenta y avisarte sobre tus reportes.</li>
        <li>El contenido de tus reportes: ubicación, descripción, fecha, fotos y, de forma opcional, la placa de un vehículo.</li>
      </ul>
      <h2>Finalidad</h2>
      <p>Gestionar los reportes ciudadanos sobre seguridad vial y comunicarte el estado de cada uno. Los reportes se muestran en el mapa público solo de forma agregada, sin fotos, placas, descripciones ni datos del autor.</p>
      <h2>Tus derechos (Ley 1581 de 2012)</h2>
      <p>Puedes conocer, actualizar, rectificar y suprimir tus datos, y revocar la autorización. Desde «Mi cuenta» puedes corregir tu nombre o eliminar la cuenta; al hacerlo, tus reportes quedan anónimos.</p>
      <h2>Seguridad</h2>
      <p>Las contraseñas se guardan cifradas con un algoritmo de hash, la comunicación usa HTTPS y las fotos se guardan sin metadatos de ubicación.</p>
    </article>
  );
}

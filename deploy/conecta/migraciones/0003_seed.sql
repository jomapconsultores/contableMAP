-- ============================================================
-- SEED DEMO — Proyecto Conecta (contexto Ecuador)
-- ============================================================

-- CARRERAS
insert into carreras (nombre, facultad) values
  ('Ingeniería en Software','Facultad de Ciencias e Ingeniería'),
  ('Enfermería','Facultad de Ciencias de la Salud'),
  ('Odontología','Facultad de Ciencias de la Salud'),
  ('Psicología Clínica','Facultad de Ciencias Sociales'),
  ('Derecho','Facultad de Jurisprudencia'),
  ('Contabilidad y Auditoría','Facultad de Ciencias Administrativas'),
  ('Administración de Empresas','Facultad de Ciencias Administrativas'),
  ('Marketing','Facultad de Ciencias Administrativas'),
  ('Educación Básica','Facultad de Educación'),
  ('Comunicación Social','Facultad de Ciencias Sociales')
on conflict (nombre) do nothing;

-- COMPETENCIAS
insert into competencias (nombre, descripcion, area) values
  ('Desarrollo Web Full-Stack','Frontend y backend con frameworks modernos','TI'),
  ('Bases de Datos SQL','Diseño y consulta de bases relacionales','TI'),
  ('Análisis de Datos','Estadística aplicada y visualización','TI'),
  ('Gestión de Proyectos','Planificación, ejecución y control (PMBOK/Scrum)','Gestión'),
  ('Atención Primaria de Salud','Cuidados de enfermería en primer nivel','Salud'),
  ('Bioseguridad','Protocolos de seguridad clínica','Salud'),
  ('Contabilidad NIIF','Normas internacionales de información financiera','Finanzas'),
  ('Tributación Ecuador','Régimen tributario y SRI','Finanzas'),
  ('Litigación Oral','Técnicas de audiencia y oralidad','Legal'),
  ('Redacción Jurídica','Elaboración de documentos legales','Legal'),
  ('Marketing Digital','Campañas, SEO/SEM y redes sociales','Marketing'),
  ('Comunicación Efectiva','Expresión oral y escrita profesional','Transversal'),
  ('Inglés B2','Competencia comunicativa en inglés','Idiomas'),
  ('Atención al Cliente','Servicio y experiencia del usuario','Transversal'),
  ('Evaluación Psicológica','Aplicación e interpretación de tests','Salud'),
  ('Ofimática Avanzada','Excel avanzado y herramientas de oficina','Transversal')
on conflict (nombre) do nothing;

-- PADRÓN DE GRADUADOS (para autollenado al registrarse por cédula)
insert into graduados_padron (cedula, nombres, apellidos, carrera_id, anio_graduacion, titulo, email_institucional, telefono, ciudad) values
  ('0102030405', 'María Fernanda', 'Guamán Loja',    (select id from carreras where nombre='Ingeniería en Software'), 2023, 'Ingeniera en Software','maria.guaman@u.edu.ec','0991112233','Cuenca'),
  ('0203040506', 'Juan Carlos',    'Pérez Tenesaca',  (select id from carreras where nombre='Contabilidad y Auditoría'), 2022, 'Ingeniero en Contabilidad','juan.perez@u.edu.ec','0982223344','Cuenca'),
  ('0304050607', 'Andrea Estefanía','Morocho Cabrera',(select id from carreras where nombre='Enfermería'), 2024, 'Licenciada en Enfermería','andrea.morocho@u.edu.ec','0973334455','Azogues'),
  ('0405060708', 'Luis Alberto',   'Sánchez Ávila',   (select id from carreras where nombre='Derecho'), 2021, 'Abogado','luis.sanchez@u.edu.ec','0964445566','Cuenca'),
  ('0506070809', 'Gabriela Nicole','Vásquez Ramón',   (select id from carreras where nombre='Marketing'), 2023, 'Licenciada en Marketing','gabriela.vasquez@u.edu.ec','0955556677','Cuenca'),
  ('0607080910', 'Diego Armando',  'Quizhpi Uyaguari',(select id from carreras where nombre='Psicología Clínica'), 2022, 'Psicólogo Clínico','diego.quizhpi@u.edu.ec','0946667788','Gualaceo')
on conflict (cedula) do nothing;

-- CURSOS DE EDUCACIÓN CONTINUA (cada uno avala una competencia)
insert into cursos (nombre, descripcion, competencia_id, duracion_horas, modalidad, precio, url) values
  ('Bootcamp Full-Stack con React y Node', 'Proyecto real de aplicación web completa', (select id from competencias where nombre='Desarrollo Web Full-Stack'), 120, 'Virtual', 350, '#'),
  ('SQL para Ciencia de Datos', 'Consultas avanzadas y modelado', (select id from competencias where nombre='Bases de Datos SQL'), 40, 'Virtual', 120, '#'),
  ('Análisis de Datos con Python', 'Pandas, visualización y estadística', (select id from competencias where nombre='Análisis de Datos'), 60, 'Híbrido', 200, '#'),
  ('Gestión de Proyectos Ágil (Scrum)', 'Certificación interna en Scrum', (select id from competencias where nombre='Gestión de Proyectos'), 32, 'Virtual', 150, '#'),
  ('NIIF para PYMES', 'Aplicación práctica de normas contables', (select id from competencias where nombre='Contabilidad NIIF'), 48, 'Presencial', 180, '#'),
  ('Tributación y SRI en la práctica', 'Declaraciones y cumplimiento', (select id from competencias where nombre='Tributación Ecuador'), 36, 'Virtual', 140, '#'),
  ('Inglés Profesional B2', 'Preparación y examen', (select id from competencias where nombre='Inglés B2'), 90, 'Híbrido', 250, '#'),
  ('Marketing Digital Integral', 'SEO, SEM y redes', (select id from competencias where nombre='Marketing Digital'), 50, 'Virtual', 160, '#'),
  ('Excel Avanzado para Profesionales', 'Tablas dinámicas, Power Query', (select id from competencias where nombre='Ofimática Avanzada'), 24, 'Virtual', 90, '#')
on conflict do nothing;

-- EMPRESAS VALIDADAS
insert into empresas (nombre, ruc, sector, descripcion, contacto_email, validada) values
  ('TecnoAustro S.A.', '0190001112001', 'Tecnología', 'Desarrollo de software y servicios cloud en el austro', 'rrhh@tecnoaustro.ec', true),
  ('Contadores del Sur Cía. Ltda.', '0190002223001', 'Servicios contables', 'Firma de auditoría y contabilidad', 'talento@contadoresdelsur.ec', true),
  ('Clínica Santa Ana', '0190003334001', 'Salud', 'Centro médico privado', 'rrhh@clinicasantaana.ec', true),
  ('Estudio Jurídico Andes', '0190004445001', 'Legal', 'Bufete de abogados corporativo', 'contacto@juridicoandes.ec', true),
  ('Agencia Pixel Marketing', '0190005556001', 'Marketing', 'Agencia de marketing digital', 'hola@pixel.ec', true)
on conflict (ruc) do nothing;

-- EMPLEOS
insert into empleos (empresa_id, titulo, descripcion, ciudad, modalidad, salario_min, salario_max, estado) values
  ((select id from empresas where nombre='TecnoAustro S.A.'), 'Desarrollador/a Full-Stack Jr.', 'Desarrollo de aplicaciones web con React y Node. Trabajo en equipo ágil.', 'Cuenca', 'Híbrido', 800, 1200, 'publicado'),
  ((select id from empresas where nombre='Contadores del Sur Cía. Ltda.'), 'Asistente Contable', 'Apoyo en contabilidad NIIF y declaraciones al SRI.', 'Cuenca', 'Presencial', 550, 750, 'publicado'),
  ((select id from empresas where nombre='Clínica Santa Ana'), 'Enfermero/a de Atención Primaria', 'Atención de pacientes y aplicación de protocolos de bioseguridad.', 'Azogues', 'Presencial', 600, 850, 'publicado'),
  ((select id from empresas where nombre='Estudio Jurídico Andes'), 'Abogado/a Junior', 'Redacción jurídica y apoyo en litigación oral.', 'Cuenca', 'Presencial', 700, 1000, 'publicado'),
  ((select id from empresas where nombre='Agencia Pixel Marketing'), 'Especialista en Marketing Digital', 'Gestión de campañas SEO/SEM y redes sociales.', 'Cuenca', 'Remoto', 650, 950, 'publicado')
on conflict do nothing;

-- COMPETENCIAS REQUERIDAS POR EMPLEO
insert into empleo_competencias (empleo_id, competencia_id, requerida)
select e.id, c.id, true
from empleos e, competencias c
where (e.titulo like 'Desarrollador%' and c.nombre in ('Desarrollo Web Full-Stack','Bases de Datos SQL','Gestión de Proyectos'))
   or (e.titulo like 'Asistente Contable%' and c.nombre in ('Contabilidad NIIF','Tributación Ecuador','Ofimática Avanzada'))
   or (e.titulo like 'Enfermero%' and c.nombre in ('Atención Primaria de Salud','Bioseguridad','Comunicación Efectiva'))
   or (e.titulo like 'Abogado%' and c.nombre in ('Litigación Oral','Redacción Jurídica','Comunicación Efectiva'))
   or (e.titulo like 'Especialista en Marketing%' and c.nombre in ('Marketing Digital','Comunicación Efectiva','Análisis de Datos'))
on conflict do nothing;

-- SERVICIOS (16 activos con horas docentes planificadas)
insert into servicios (nombre, area, responsable, horas_docentes_planificadas) values
  ('Consultorio Jurídico Gratuito','Derecho','Ab. Ramírez',480),
  ('Clínica Odontológica Universitaria','Odontología','Dr. Peralta',600),
  ('Centro de Atención Psicológica','Psicología','Psic. Andrade',400),
  ('Laboratorio Clínico Comunitario','Enfermería','Lic. Torres',360),
  ('Dispensario de Salud Comunitaria','Enfermería','Lic. Bermeo',520),
  ('Centro de Emprendimiento','Administración','Ing. Ortega',300),
  ('Consultorio Contable y Tributario','Contabilidad','CPA Salazar',280),
  ('Fábrica de Software Universitaria','Software','Ing. Cordero',440),
  ('Centro de Idiomas','Idiomas','Lic. Wright',500),
  ('Radio Universitaria','Comunicación','Com. Vega',260),
  ('Centro de Apoyo Pedagógico','Educación','Msc. León',320),
  ('Casa Abierta de Marketing','Marketing','Ing. Pinos',240),
  ('Brigadas de Salud Rural','Enfermería','Lic. Chalco',600),
  ('Oficina de Mediación y Arbitraje','Derecho','Ab. Moscoso',300),
  ('Centro de Nutrición Comunitaria','Salud','Nut. Arévalo',280),
  ('Laboratorio de Innovación Social','Administración','Ing. Riera',260)
on conflict do nothing;

-- ATENCIONES (para tableros de ejecución vs planificado)
insert into servicio_atenciones (servicio_id, fecha, horas_reales, num_atenciones, docente)
select s.id, date '2026-06-01' + (g*7), (s.horas_docentes_planificadas/20.0)*(0.6+0.05*g), 10+g, s.responsable
from servicios s, generate_series(0,3) as g
on conflict do nothing;

-- PRÁCTICAS PREPROFESIONALES
insert into practicas_preprofesionales (estudiante_nombre, servicio_id, horas_planificadas, horas_cumplidas, tutor, estado) values
  ('Sofía Idrovo', (select id from servicios where nombre='Fábrica de Software Universitaria'), 240, 180, 'Ing. Cordero', 'en_curso'),
  ('Mateo Zhingre', (select id from servicios where nombre='Consultorio Jurídico Gratuito'), 240, 240, 'Ab. Ramírez', 'finalizada'),
  ('Camila Ortiz', (select id from servicios where nombre='Centro de Atención Psicológica'), 200, 90, 'Psic. Andrade', 'en_curso'),
  ('Nicolás Vera', (select id from servicios where nombre='Clínica Odontológica Universitaria'), 240, 210, 'Dr. Peralta', 'en_curso')
on conflict do nothing;

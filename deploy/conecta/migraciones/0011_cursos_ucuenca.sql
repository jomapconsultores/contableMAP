-- ============================================================
-- 0011 — Catálogo real de Educación Continua (ucuenca.edu.ec)
-- ============================================================
-- Los cursos "demo" (sembrados en 0003_seed.sql) simulan el cierre de brechas de
-- competencias con un botón "Aprobar" que avala una competencia interna. Los
-- programas reales de ucuenca.edu.ec/educacion-continua/ no pueden verificarse
-- desde esta app, así que se muestran como catálogo informativo con enlace a la
-- página real para inscribirse — sin botón de aprobación simulada.

alter table cursos add column if not exists origen text not null default 'demo';
alter table cursos add column if not exists categoria text;
alter table cursos add column if not exists fecha_inicio date;
alter table cursos add column if not exists fecha_fin date;
alter table cursos add column if not exists publico_objetivo text;
alter table cursos add column if not exists estado_inscripcion text not null default 'abierta';

-- Único parcial sobre nombre para los cursos reales de ucuenca.edu.ec: permite reinsertar
-- este seed sin duplicar filas en cada aplicación de la migración.
create unique index if not exists cursos_ucuenca_nombre_key on cursos (nombre) where origen = 'ucuenca';

insert into cursos (nombre, descripcion, modalidad, duracion_horas, precio, url,
                     origen, categoria, fecha_inicio, fecha_fin, publico_objetivo, estado_inscripcion)
values
  ('Escuela de Empleabilidad',
   'Herramientas prácticas y conocimientos clave para fortalecer tus oportunidades profesionales: potencial personal, competencias sociales y estrategias comerciales.',
   'Virtual', null, 25, 'https://www.ucuenca.edu.ec/programas-educ/escuela-de-empleabilidad/',
   'ucuenca', 'MOOC', '2026-04-08', '2026-08-01', 'Graduados UCuenca y público en general', 'abierta'),

  ('Habilidades Blandas',
   'Comunicación efectiva, relaciones interpersonales, liderazgo, resolución de conflictos y negociación, trabajo en equipo y pensamiento analítico-reflexivo.',
   'Virtual', null, 45, 'https://www.ucuenca.edu.ec/programas-educ/habilidades-blandas-2/',
   'ucuenca', 'MOOC', '2026-04-08', '2026-11-01', 'Público en general', 'abierta'),

  ('Escritura Académica',
   'Fortalece tus habilidades de redacción académica: coherencia, cohesión y rigor en textos universitarios y científicos, con convenciones de estilo, citación y argumentación.',
   'Virtual', null, 45, 'https://www.ucuenca.edu.ec/programas-educ/escritura-academica/',
   'ucuenca', 'MOOC', '2026-04-08', '2026-11-01', 'Público en general', 'abierta'),

  ('Herramientas de Inteligencia Artificial para la Educación',
   'Conoce y aplica herramientas de IA en el aula: asistentes como ChatGPT, generación de contenido, plataformas de aprendizaje automatizado y diseño de actividades personalizadas.',
   'Virtual', null, 45, 'https://www.ucuenca.edu.ec/programas-educ/herramientas-de-inteligencia-artificial-para-la-educacion-2/',
   'ucuenca', 'MOOC', '2026-04-07', '2026-10-31', 'Docentes y profesionales', 'abierta'),

  ('Habilidades Pedagógicas con Enfoque de Igualdad',
   'Desarrolla competencias pedagógicas sólidas para planificar, implementar y evaluar una educación inclusiva y de calidad, con apoyo de herramientas digitales.',
   'Virtual', null, 45, 'https://www.ucuenca.edu.ec/programas-educ/habilidades-pedagogicas-con-enfoque-de-igualdad-2/',
   'ucuenca', 'MOOC', '2026-04-08', '2026-11-01', 'Público en general', 'abierta'),

  ('Habilidades Pedagógicas con Enfoque de Género e Interculturalidad',
   'Desarrolla competencias pedagógicas desde una perspectiva de género e interculturalidad, con marcos de análisis e instrumentos prácticos para la mentoría educativa.',
   'Virtual', null, 45, 'https://www.ucuenca.edu.ec/programas-educ/habilidades-pedagogicas-con-enfoque-de-genero-e-interculturalidad-2/',
   'ucuenca', 'MOOC', '2026-04-08', '2026-11-01', 'Público en general', 'abierta'),

  ('VI Congreso Internacional de Producción Animal Especializada en Bovinos',
   'Actualización técnica, biotecnologías e investigación científica en sistemas de producción bovina, orientado al sector ganadero y de producción láctea y cárnica.',
   'Presencial', 24, 120, 'https://www.ucuenca.edu.ec/programas-educ/vi-congreso-internacional-de-produccion-animal-especializada-en-bovinos/',
   'ucuenca', 'Congreso', '2026-10-15', '2026-10-18', 'Profesionales del sector ganadero', 'abierta')
on conflict (nombre) where origen = 'ucuenca' do nothing;

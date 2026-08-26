-- Amplía las categorías del repositorio de documentos personales: además de
-- cédula/título/certificado/CV/contrato, ahora se puede clasificar por
-- curso, seminario/taller/congreso, artículo científico, y experiencia
-- laboral profesional/académica/administrativa-académica. El nombre del
-- archivo arrastrado sugiere la categoría (ver sugerirCategoria en
-- src/lib/documentos.ts); el usuario puede corregirla antes de subir.
alter table documentos_personales drop constraint if exists documentos_personales_categoria_check;
alter table documentos_personales add constraint documentos_personales_categoria_check
  check (categoria in (
    'cedula','titulo','certificado','cv','contrato',
    'curso','seminario','articulo_cientifico',
    'experiencia_profesional','experiencia_academica','experiencia_administrativa',
    'otro'
  ));

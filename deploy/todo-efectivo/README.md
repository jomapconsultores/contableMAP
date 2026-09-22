# Gastos en efectivo desde Microsoft To Do

Los pagos en efectivo se dictan a la lista **📅 Gastos personales** de Microsoft
To Do, en texto libre ("19 de agosto del 2026 compré una cola en la tienda por
1.70"). Esta tarea los lleva a ContableMAP, a la cuenta **Caja - Efectivo**,
clasificados y sin contabilizar.

## Cómo funciona

1. `enviar.mjs` lee la copia local que la app de To Do guarda en el PC
   (`%LOCALAPPDATA%\Packages\Microsoft.Todos_8wekyb3d8bbwe\...\todosqlite.db`).
   No hace falta conectar la cuenta de Microsoft.
2. Manda las notas de los últimos 60 días a `POST /api/integracion/efectivo`,
   de cinco en cinco.
3. ContableMAP descarta las que ya importó (cada movimiento guarda el id de su
   tarea en `referencia`), interpreta las nuevas con Ollama y las registra.

## Configuración

`%USERPROFILE%\.contablemap\efectivo.json`, fuera del repositorio:

```json
{ "url": "https://map.pensamiento-libre.org", "token": "…", "entidad_ruc": "1710308741001" }
```

El token es el valor de `EFECTIVO_TOKEN` en las variables de `contable-map` en
Coolify. Para revocarlo basta con cambiarlo allí.

## Tarea programada

Se registra una vez, en PowerShell:

```powershell
$accion = New-ScheduledTaskAction -Execute "node.exe" `
  -Argument "--no-warnings `"$PWD\deploy\todo-efectivo\enviar.mjs`""
$cuando = New-ScheduledTaskTrigger -Daily -At 21:00
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
Register-ScheduledTask -TaskName "ContableMAP - efectivo To Do" `
  -Action $accion -Trigger $cuando -Settings $ajustes
```

`-StartWhenAvailable` la ejecuta en cuanto se encienda el PC si a las 21:00
estaba apagado. El resultado de cada corrida queda en
`%USERPROFILE%\.contablemap\efectivo.log`.

`node enviar.mjs --prueba` muestra qué notas mandaría, sin mandar nada.

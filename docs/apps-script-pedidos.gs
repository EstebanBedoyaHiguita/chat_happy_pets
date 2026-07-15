/**
 * Webhook del Sheet de pedidos de Happy Pets.
 *
 * Recibe dos acciones desde la app (src/lib/sheet-payload.ts):
 *  - action 'create' (o sin action): agrega una fila nueva al final.
 *  - action 'update': busca la fila por orderNumber (columna 30) y la reescribe.
 *
 * Para publicar: Implementar > Nueva implementación > Aplicación web
 * (ejecutar como: yo / con acceso: cualquier persona) y pegar la URL en
 * la variable de entorno GOOGLE_SHEETS_WEBHOOK.
 */

var COL = {
  fecha: 1,
  celular: 2,
  vend: 3,
  nombreCliente: 4,
  pollo: 5,
  fruta: 6,
  cordero: 7,
  res: 8,
  pez: 9,
  conejo: 10,
  salmon: 11,
  gPollo: 12,
  gTernera: 13,
  tipoPago: 17,
  snacks: 21,
  observaciones: 22,
  orderNumber: 30,
}

function doPost(e) {
  var lock = LockService.getScriptLock()
  try {
    // Sin lock, dos pedidos simultáneos calculan la misma fila vacía y uno pisa al otro.
    lock.waitLock(30000)

    var data = JSON.parse(e.postData.contents)
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet()

    if (data.action === 'update') {
      var row = findRowByOrderNumber_(sheet, data.orderNumber)
      if (!row) {
        return json_({ success: false, error: 'order_not_found', orderNumber: data.orderNumber })
      }
      writeOrder_(sheet, row, data, true)
      return json_({ success: true, action: 'update', row: row })
    }

    var newRow = firstEmptyRow_(sheet)
    writeOrder_(sheet, newRow, data, false)
    return json_({ success: true, action: 'create', row: newRow })
  } catch (err) {
    return json_({ error: err.message })
  } finally {
    lock.releaseLock()
  }
}

/** Busca de abajo hacia arriba: si un orderNumber se repitiera, gana la fila más reciente. */
function findRowByOrderNumber_(sheet, orderNumber) {
  if (!orderNumber) return null
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) return null

  var values = sheet.getRange(2, COL.orderNumber, lastRow - 1, 1).getValues()
  var target = String(orderNumber).trim()
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]).trim() === target) return i + 2
  }
  return null
}

/** Primera fila libre según la columna A (misma lógica que tenías antes). */
function firstEmptyRow_(sheet) {
  var colA = sheet.getRange('A:A').getValues()
  var targetRow = 2 // fila 1 = encabezados
  for (var i = 1; i < colA.length; i++) {
    if (colA[i][0] !== '') {
      targetRow = i + 2
    }
  }
  return targetRow
}

function writeOrder_(sheet, row, data, isUpdate) {
  // En un update no se tocan fecha ni vend: conservan la fecha original del pedido y
  // el asesor que lo cargó (si lo cargó una persona, el bot no debe robarle el crédito).
  if (!isUpdate) {
    sheet.getRange(row, COL.fecha).setValue(data.fecha || '')
    sheet.getRange(row, COL.vend).setValue(data.vend || 'Bot')
  }

  sheet.getRange(row, COL.celular).setValue(data.celular || '')
  sheet.getRange(row, COL.nombreCliente).setValue(data.nombreCliente || '')

  // Las cantidades se escriben SIEMPRE, incluso vacías: si el cliente quitó un producto
  // en una edición, su celda debe quedar en blanco y no con la cantidad vieja.
  sheet.getRange(row, COL.pollo).setValue(data.pollo || '')
  sheet.getRange(row, COL.fruta).setValue(data.fruta || '')
  sheet.getRange(row, COL.cordero).setValue(data.cordero || '')
  sheet.getRange(row, COL.res).setValue(data.res || '')
  sheet.getRange(row, COL.pez).setValue(data.pez || '')
  sheet.getRange(row, COL.conejo).setValue(data.conejo || '')
  sheet.getRange(row, COL.salmon).setValue(data.salmon || '')
  sheet.getRange(row, COL.gPollo).setValue(data.gPollo || '')
  sheet.getRange(row, COL.gTernera).setValue(data.gTernera || '')

  // Igual que las cantidades: en update deben poder vaciarse.
  sheet.getRange(row, COL.tipoPago).setValue(data.tipoPago || '')
  sheet.getRange(row, COL.snacks).setValue(data.snacks || '')
  sheet.getRange(row, COL.observaciones).setValue(data.observaciones || '')
  sheet.getRange(row, COL.orderNumber).setValue(data.orderNumber || '')
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
}

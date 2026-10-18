import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDtc, parseDtcResponse, parsePidResponse, parseMessages, responseError, protocolName, isCanProtocol } from '../web/js/obd.js';
import { DemoElm327 } from '../web/js/elm327.js';

test('декодирование DTC по SAE J2012', () => {
  assert.equal(decodeDtc(0x01, 0x33), 'P0133');
  assert.equal(decodeDtc(0x03, 0x00), 'P0300');
  assert.equal(decodeDtc(0x41, 0x23), 'C0123');
  assert.equal(decodeDtc(0x81, 0x23), 'B0123');
  assert.equal(decodeDtc(0xC1, 0x00), 'U0100');
  assert.equal(decodeDtc(0x11, 0x01), 'P1101');
});

test('Mode 03, не-CAN (ISO 9141/KWP): 3 кода на кадр, нули — пустые', () => {
  assert.deepEqual(parseDtcResponse('43 01 33 00 00 00 00\r\r>'), ['P0133']);
  assert.deepEqual(parseDtcResponse('43 01 33 04 20 C1 00\r43 01 71 00 00 00 00\r>', { can: false }), ['P0133', 'P0420', 'U0100', 'P0171']);
});

test('Mode 03, CAN одиночный кадр с байтом количества', () => {
  assert.deepEqual(parseDtcResponse('SEARCHING...\r43 02 03 01 01 71\r\r>'), ['P0301', 'P0171']);
  assert.deepEqual(parseDtcResponse('43 00\r>'), []);
});

test('Mode 03, CAN многокадровый ответ', () => {
  const raw = '00A\r0: 43 04 03 01 01 71\r1: 04 20 C1 00 00 00 00\r\r>';
  assert.deepEqual(parseDtcResponse(raw, { can: true }), ['P0301', 'P0171', 'P0420', 'U0100']);
});

test('NO DATA и ошибки адаптера', () => {
  assert.deepEqual(parseDtcResponse('NO DATA\r>'), []);
  assert.equal(responseError('SEARCHING...\rUNABLE TO CONNECT\r>'), 'UNABLE TO CONNECT');
  assert.equal(responseError('41 0C 1A F8'), null);
});

test('PID Mode 01 по формулам SAE J1979', () => {
  assert.equal(parsePidResponse('41 0C 1A F8\r>', '0C').value, 1726);
  assert.equal(parsePidResponse('41 0D 3C\r>', '0D').value, 60);
  assert.equal(parsePidResponse('41 05 7B\r>', '05').value, 83);
  assert.equal(parsePidResponse('41 04 FF\r>', '04').value, 100);
  assert.equal(parsePidResponse('41 04 80\r>', '04').value, 50.2);
  assert.equal(parsePidResponse('41 42 37 6E\r>', '42').value, 14.19);
  assert.equal(parsePidResponse('41 06 80\r>', '06').value, 0);
  assert.deepEqual(parsePidResponse('41 01 83 07 E5 00', '01').value, { mil: true, count: 3 });
  assert.equal(parsePidResponse('NO DATA\r>', '0C'), null);
  assert.equal(parsePidResponse('7E8 03 41 0D 3C', '0D').value, 60); // с заголовками тоже
});

test('Mode 02 freeze frame (номер кадра после PID)', () => {
  assert.equal(parsePidResponse('42 0C 00 0B B8\r>', '0C', 0x02).value, 750);
  assert.equal(parsePidResponse('42 05 00 7B\r>', '05', 0x02).value, 83);
});

test('многокадровые сообщения склеиваются', () => {
  assert.deepEqual(parseMessages('008\r0: 49 02 01 4C 56 56\r1: 44 42 00 00 00 00'), [[0x49, 0x02, 0x01, 0x4c, 0x56, 0x56, 0x44, 0x42]]);
});

test('протоколы', () => {
  assert.equal(protocolName('A6'), 'ISO 15765-4 CAN (11 бит, 500 кбит/с)');
  assert.ok(isCanProtocol('6')); assert.ok(!isCanProtocol('3'));
});

test('демо-адаптер: полный цикл', async () => {
  const d = new DemoElm327({ codes: ['P0301', 'P0420'], delay: 0 });
  await d.connect();
  assert.match(await d.send('ATZ'), /ELM327/);
  assert.match(await d.send('ATE0'), /OK/);
  assert.deepEqual(parseDtcResponse(await d.send('03')), ['P0301', 'P0420']);
  const rpm = parsePidResponse(await d.send('010C'), '0C').value;
  assert.ok(rpm > 500 && rpm < 2000, `rpm=${rpm}`);
  await d.send('04');
  assert.deepEqual(parseDtcResponse(await d.send('03')), []);
  assert.equal(DemoElm327.encodeDtc('U0100'), 'C1 00');
});

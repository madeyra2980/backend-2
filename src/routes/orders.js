import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isAllowedSpecialtyId } from '../constants/specialties.js';

const router = Router();

function mapOrderRow(r) {
  const specialistName =
    [r.specialist_first_name, r.specialist_last_name].filter(Boolean).join(' ').trim() ||
    (r.specialist_id ? 'Специалист' : null);
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone || null,
    specialtyId: r.specialty_id,
    description: r.description,
    proposedPrice: r.proposed_price != null ? parseFloat(r.proposed_price) : null,
    preferredAt: r.preferred_at,
    latitude: r.latitude != null ? parseFloat(r.latitude) : null,
    longitude: r.longitude != null ? parseFloat(r.longitude) : null,
    addressText: r.address_text,
    status: r.status,
    specialistId: r.specialist_id,
    specialistName: specialistName || null,
    specialistPhone: r.specialist_phone || null,
    specialistLatitude: r.specialist_latitude != null ? parseFloat(r.specialist_latitude) : null,
    specialistLongitude: r.specialist_longitude != null ? parseFloat(r.specialist_longitude) : null,
    specialistLocationUpdatedAt: r.specialist_location_updated_at || null,
    customerLatitude: r.customer_latitude != null ? parseFloat(r.customer_latitude) : null,
    customerLongitude: r.customer_longitude != null ? parseFloat(r.customer_longitude) : null,
    customerLocationUpdatedAt: r.customer_location_updated_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Создать заявку (заказчик)
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { specialtyId, description, proposedPrice, preferredAt, latitude, longitude, addressText } = req.body;

    if (!specialtyId || !isAllowedSpecialtyId(specialtyId)) {
      return res.status(400).json({ error: 'Укажите корректную специальность (услугу)' });
    }

    // Пока есть заявка в статусе "в поиске специалиста" — новую создавать нельзя
    const existingOpen = await query(
      'SELECT id FROM orders WHERE customer_id = $1 AND status = $2 LIMIT 1',
      [userId, 'open']
    );
    if (existingOpen.rows.length > 0) {
      return res.status(400).json({
        error: 'У вас уже есть заявка в поиске специалиста. Дождитесь отклика или завершите текущую заявку.',
      });
    }

    const price = proposedPrice != null ? parseFloat(proposedPrice) : null;
    const lat = latitude != null ? parseFloat(latitude) : null;
    const lng = longitude != null ? parseFloat(longitude) : null;
    const prefAt = preferredAt ? new Date(preferredAt) : null;

    const result = await query(
      `INSERT INTO orders (customer_id, specialty_id, description, proposed_price, preferred_at, latitude, longitude, address_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
       RETURNING id, customer_id, specialty_id, description, proposed_price, preferred_at, latitude, longitude, address_text, status, specialist_id, created_at, updated_at`,
      [userId, specialtyId, description || null, price, prefAt, lat, lng, addressText || null]
    );

    const row = result.rows[0];
    const customerName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ') || req.user.email?.split('@')[0] || 'Заказчик';
    res.status(201).json({
      order: mapOrderRow({ ...row, customer_name: customerName }),
      message: 'Заявка создана',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Таблица заявок ещё не создана. Выполните миграцию (migrations/schema.sql)' });
    }
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Ошибка при создании заявки' });
  }
});

// Список заявок: ?my=1 — мои как заказчик; ?asSpecialist=1 — мои как специалист (принятые); иначе — доступные (open)
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const my = req.query.my === '1' || req.query.my === 'true';
    const asSpecialist = req.query.asSpecialist === '1' || req.query.asSpecialist === 'true';

    if (asSpecialist) {
      const result = await query(
        `SELECT o.id, o.customer_id, o.specialty_id, o.description, o.proposed_price, o.preferred_at,
                o.latitude, o.longitude, o.address_text, o.status, o.specialist_id, o.created_at, o.updated_at,
                o.specialist_latitude, o.specialist_longitude, o.specialist_location_updated_at,
                o.customer_latitude, o.customer_longitude, o.customer_location_updated_at,
                cust."firstName" || ' ' || COALESCE(cust."lastName", '') as customer_name,
                cust.phone as customer_phone,
                spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
         FROM orders o
         JOIN users cust ON cust.id = o.customer_id
         LEFT JOIN users spec ON spec.id = o.specialist_id
         WHERE o.specialist_id = $1
         ORDER BY o.created_at DESC`,
        [userId]
      );
      return res.json({
        orders: result.rows.map((r) => mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' })),
      });
    }

    if (my) {
      const result = await query(
        `SELECT o.id, o.customer_id, o.specialty_id, o.description, o.proposed_price, o.preferred_at,
                o.latitude, o.longitude, o.address_text, o.status, o.specialist_id, o.created_at, o.updated_at,
                o.specialist_latitude, o.specialist_longitude, o.specialist_location_updated_at,
                o.customer_latitude, o.customer_longitude, o.customer_location_updated_at,
                cust."firstName" || ' ' || COALESCE(cust."lastName", '') as customer_name,
                cust.phone as customer_phone,
                spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
         FROM orders o
         JOIN users cust ON cust.id = o.customer_id
         LEFT JOIN users spec ON spec.id = o.specialist_id
         WHERE o.customer_id = $1
         ORDER BY o.created_at DESC`,
        [userId]
      );
      return res.json({
        orders: result.rows.map((r) => mapOrderRow({ ...r, customer_name: r.customer_name?.trim() || 'Вы' })),
      });
    }

    const userResult = await query(
      'SELECT specialist_specialties FROM users WHERE id = $1',
      [userId]
    );
    const specialties = userResult.rows[0]?.specialist_specialties;
    if (!Array.isArray(specialties) || specialties.length === 0) {
      return res.json({ orders: [] });
    }

    const result = await query(
      `SELECT o.id, o.customer_id, o.specialty_id, o.description, o.proposed_price, o.preferred_at,
              o.latitude, o.longitude, o.address_text, o.status, o.specialist_id, o.created_at, o.updated_at,
              o.specialist_latitude, o.specialist_longitude, o.specialist_location_updated_at,
              o.customer_latitude, o.customer_longitude, o.customer_location_updated_at,
              (u."firstName" || ' ' || COALESCE(u."lastName", '')) as customer_name,
              u.phone as customer_phone
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       WHERE o.status = 'open' AND o.specialty_id = ANY($1::text[])
       ORDER BY o.created_at DESC`,
      [specialties]
    );

    res.json({
      orders: result.rows.map((r) => mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' })),
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ orders: [] });
    }
    if (err.message?.includes('column') && err.message?.includes('does not exist')) {
      return res.json({ orders: [] });
    }
    console.error('List orders error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке заявок' });
  }
});

// Одна заявка по id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT o.id, o.customer_id, o.specialty_id, o.description, o.proposed_price, o.preferred_at,
              o.latitude, o.longitude, o.address_text, o.status, o.specialist_id, o.created_at, o.updated_at,
              o.specialist_latitude, o.specialist_longitude, o.specialist_location_updated_at,
              o.customer_latitude, o.customer_longitude, o.customer_location_updated_at,
              (u."firstName" || ' ' || COALESCE(u."lastName", '')) as customer_name,
              u.phone as customer_phone,
              spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN users spec ON spec.id = o.specialist_id
       WHERE o.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const r = result.rows[0];
    res.json({ order: mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' }) });
  } catch (err) {
    if (err.code === '42P01') return res.status(404).json({ error: 'Заявка не найдена' });
    console.error('Get order error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке заявки' });
  }
});

// Специалист отправляет свою геопозицию (еду к клиенту — мониторинг как InDriver)
router.patch('/:id/specialist-location', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { latitude, longitude } = req.body || {};
    const lat = latitude != null ? parseFloat(latitude) : null;
    const lng = longitude != null ? parseFloat(longitude) : null;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Укажите latitude и longitude (числа)' });
    }

    const orderResult = await query(
      'SELECT id, specialist_id, status FROM orders WHERE id = $1',
      [id]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const order = orderResult.rows[0];
    if (order.specialist_id !== userId) {
      return res.status(403).json({ error: 'Вы не являетесь исполнителем этой заявки' });
    }
    if (order.status !== 'accepted' && order.status !== 'in_progress') {
      return res.status(400).json({ error: 'Геопозицию можно передавать только для заявки в статусе «принята» или «еду»' });
    }

    await query(
      `UPDATE orders SET specialist_latitude = $1, specialist_longitude = $2, specialist_location_updated_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [lat, lng, id]
    );

    const updated = await query(
      `SELECT o.*, (u."firstName" || ' ' || COALESCE(u."lastName", '')) as customer_name,
              spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN users spec ON spec.id = o.specialist_id
       WHERE o.id = $1`,
      [id]
    );
    const r = updated.rows[0];
    res.json({
      order: mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' }),
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Таблица заявок ещё не создана' });
    }
    console.error('Specialist location error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении геопозиции' });
  }
});

// Клиент отправляет свою геопозицию (для специалиста — мониторинг как InDriver)
router.patch('/:id/customer-location', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { latitude, longitude } = req.body || {};
    const lat = latitude != null ? parseFloat(latitude) : null;
    const lng = longitude != null ? parseFloat(longitude) : null;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Укажите latitude и longitude (числа)' });
    }

    const orderResult = await query(
      'SELECT id, customer_id, status FROM orders WHERE id = $1',
      [id]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const order = orderResult.rows[0];
    if (order.customer_id !== userId) {
      return res.status(403).json({ error: 'Вы не являетесь заказчиком этой заявки' });
    }
    if (order.status !== 'accepted' && order.status !== 'in_progress') {
      return res.status(400).json({ error: 'Геопозицию можно передавать только для принятой или активной заявки' });
    }

    await query(
      `UPDATE orders SET customer_latitude = $1, customer_longitude = $2, customer_location_updated_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [lat, lng, id]
    );

    res.json({ ok: true });
  } catch (err) {
    if (err.code === '42P01' || (err.message?.includes('column') && err.message?.includes('does not exist'))) {
      return res.json({ ok: true }); // колонки ещё не созданы — тихо игнорируем
    }
    console.error('Customer location error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении геопозиции' });
  }
});

// Принять заявку (специалист)
router.patch('/:id/accept', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const orderResult = await query(
      'SELECT id, customer_id, specialty_id, status, specialist_id FROM orders WHERE id = $1',
      [id]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const order = orderResult.rows[0];
    if (order.status !== 'open') {
      return res.status(400).json({ error: 'Заявка уже занята или закрыта' });
    }

    const userResult = await query(
      'SELECT specialist_specialties FROM users WHERE id = $1',
      [userId]
    );
    const specialties = userResult.rows[0]?.specialist_specialties || [];
    if (!specialties.includes(order.specialty_id)) {
      return res.status(403).json({ error: 'Вы не оказываете такую услугу' });
    }

    await query(
      `UPDATE orders SET specialist_id = $1, status = 'accepted', updated_at = NOW() WHERE id = $2`,
      [userId, id]
    );

    const updated = await query(
      `SELECT o.*, (u."firstName" || ' ' || COALESCE(u."lastName", '')) as customer_name,
              spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN users spec ON spec.id = o.specialist_id
       WHERE o.id = $1`,
      [id]
    );
    const r = updated.rows[0];
    res.json({
      order: mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' }),
      message: 'Вы приняли заявку',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Таблица заявок ещё не создана' });
    }
    console.error('Accept order error:', err);
    res.status(500).json({ error: 'Ошибка при принятии заявки' });
  }
});

// Заказчик отказывается от специалиста — заявка снова в поиске (open, specialist_id = null)
router.patch('/:id/reject-specialist', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const orderResult = await query(
      'SELECT id, customer_id, status FROM orders WHERE id = $1',
      [id]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const order = orderResult.rows[0];
    if (order.customer_id !== userId) {
      return res.status(403).json({ error: 'Только заказчик может отказаться от исполнителя' });
    }
    if (order.status !== 'accepted' && order.status !== 'in_progress') {
      return res.status(400).json({ error: 'Отказаться можно только от принятой или активной заявки' });
    }

    await query(
      'UPDATE orders SET specialist_id = NULL, status = \'open\', specialist_latitude = NULL, specialist_longitude = NULL, specialist_location_updated_at = NULL, updated_at = NOW() WHERE id = $1',
      [id]
    );

    const updated = await query(
      `SELECT o.*, (u."firstName" || ' ' || COALESCE(u."lastName", '')) as customer_name,
              spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN users spec ON spec.id = o.specialist_id
       WHERE o.id = $1`,
      [id]
    );
    const r = updated.rows[0];
    res.json({
      order: mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' }),
      message: 'Исполнитель отклонён, заявка снова в поиске',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Таблица заявок ещё не создана' });
    }
    console.error('Reject specialist error:', err);
    res.status(500).json({ error: 'Ошибка при отказе от исполнителя' });
  }
});

// Специалист отказывается от заявки — заявка снова в поиске (open, specialist_id = null)
router.patch('/:id/release', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const orderResult = await query(
      'SELECT id, specialist_id, status FROM orders WHERE id = $1',
      [id]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const order = orderResult.rows[0];
    if (order.specialist_id !== userId) {
      return res.status(403).json({ error: 'Вы не являетесь исполнителем этой заявки' });
    }
    if (order.status !== 'accepted' && order.status !== 'in_progress') {
      return res.status(400).json({ error: 'Отказаться можно только от принятой или активной заявки' });
    }

    await query(
      'UPDATE orders SET specialist_id = NULL, status = \'open\', specialist_latitude = NULL, specialist_longitude = NULL, specialist_location_updated_at = NULL, updated_at = NOW() WHERE id = $1',
      [id]
    );

    const updated = await query(
      `SELECT o.*, (u."firstName" || ' ' || COALESCE(u."lastName", '')) as customer_name,
              spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN users spec ON spec.id = o.specialist_id
       WHERE o.id = $1`,
      [id]
    );
    const r = updated.rows[0];
    res.json({
      order: mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' }),
      message: 'Вы отказались от заявки',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Таблица заявок ещё не создана' });
    }
    console.error('Release order error:', err);
    res.status(500).json({ error: 'Ошибка при отказе от заявки' });
  }
});

// Заказчик отменяет заявку (open, accepted, in_progress)
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const orderResult = await query(
      'SELECT id, customer_id, status FROM orders WHERE id = $1',
      [id]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const order = orderResult.rows[0];
    if (order.customer_id !== userId) {
      return res.status(403).json({ error: 'Только заказчик может отменить заявку' });
    }
    const cancellable = ['open', 'accepted', 'in_progress'];
    if (!cancellable.includes(order.status)) {
      return res.status(400).json({ error: 'Заявку нельзя отменить в текущем статусе' });
    }

    await query(
      'UPDATE orders SET status = \'cancelled\', updated_at = NOW() WHERE id = $1',
      [id]
    );

    const updated = await query(
      `SELECT o.*, (u."firstName" || ' ' || COALESCE(u."lastName", '')) as customer_name,
              spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN users spec ON spec.id = o.specialist_id
       WHERE o.id = $1`,
      [id]
    );
    const r = updated.rows[0];
    res.json({
      order: mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' }),
      message: 'Заявка отменена',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Таблица заявок ещё не создана' });
    }
    console.error('Cancel order error:', err);
    res.status(500).json({ error: 'Ошибка при отмене заявки' });
  }
});

// Специалист меняет статус заявки на "Еду" (in_progress) или "Выполнена" (completed)
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status } = req.body || {};
    const allowed = ['in_progress', 'completed'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'Укажите status: in_progress (еду) или completed (выполнена)' });
    }

    const orderResult = await query(
      'SELECT id, specialist_id, status FROM orders WHERE id = $1',
      [id]
    );
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    const order = orderResult.rows[0];
    if (order.specialist_id !== userId) {
      return res.status(403).json({ error: 'Вы не являетесь исполнителем этой заявки' });
    }
    if (order.status === 'open') {
      return res.status(400).json({ error: 'Сначала примите заявку' });
    }

    await query(
      'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );

    const updated = await query(
      `SELECT o.*, (u."firstName" || ' ' || COALESCE(u."lastName", '')) as customer_name,
              spec."firstName" as specialist_first_name, spec."lastName" as specialist_last_name, spec.phone as specialist_phone
       FROM orders o
       JOIN users u ON u.id = o.customer_id
       LEFT JOIN users spec ON spec.id = o.specialist_id
       WHERE o.id = $1`,
      [id]
    );
    const r = updated.rows[0];
    res.json({
      order: mapOrderRow({ ...r, customer_name: (r.customer_name || '').trim() || 'Заказчик' }),
      message: status === 'in_progress' ? 'Статус: Еду' : 'Заявка выполнена',
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Таблица заявок ещё не создана' });
    }
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении статуса' });
  }
});

export default router;

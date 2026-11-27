/**
 * Vercel Serverless Function: /api/paymongo
 * Requires environment variable PAYMONGO_SECRET_KEY in Vercel Project Settings.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ error: 'PAYMONGO_SECRET_KEY is not configured in Vercel environment variables.' });
  }

  try {
    const { orderId, amountInPesos, paymentMethod, description, customerName, phone } = req.body || {};
    const amountInCentavos = Math.round(Number(amountInPesos) * 100);

    if (!amountInCentavos || amountInCentavos < 100) {
      return res.status(400).json({ error: 'Invalid order amount.' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const methodMap = {
      gcash: ['gcash'],
      maya: ['paymaya'],
      grab_pay: ['grab_pay'],
      card: ['card']
    };
    const paymentMethodTypes = methodMap[paymentMethod] || ['gcash', 'paymaya', 'card'];

    const authHeader = 'Basic ' + Buffer.from(`${secretKey}:`).toString('base64');

    const pmResponse = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [
              {
                name: description || `DavaoFresh Order ${orderId}`,
                quantity: 1,
                amount: amountInCentavos,
                currency: 'PHP'
              }
            ],
            payment_method_types: paymentMethodTypes,
            billing: {
              name: customerName || 'Customer',
              phone: phone || ''
            },
            success_url: `${origin}/?payment=success&orderId=${encodeURIComponent(orderId || '')}`,
            cancel_url: `${origin}/?payment=cancelled&orderId=${encodeURIComponent(orderId || '')}`,
            description: description || `Order ${orderId}`
          }
        }
      })
    });

    const pmJson = await pmResponse.json();
    if (!pmResponse.ok) {
      const detail = pmJson?.errors?.[0]?.detail || 'PayMongo API rejected the request';
      return res.status(pmResponse.status).json({ error: detail });
    }

    const checkoutUrl = pmJson?.data?.attributes?.checkout_url;
    return res.status(200).json({
      checkoutUrl,
      sessionId: pmJson?.data?.id
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error calling PayMongo' });
  }
}

import { get, set } from 'idb-keyval'
import { supabase } from './supabase'

const QUEUE = 'sale-queue'
const PRODUCTS = 'products-cache'

export const getQueue = async () => (await get(QUEUE)) || []

export async function enqueueSale(sale) {
  const q = await getQueue()
  await set(QUEUE, [...q, sale])
}

// يرفع العمليات المعلّقة بالترتيب، ويتوقف عند أول فشل (مثلاً انقطاع النت)
export async function flushQueue() {
  let q = await getQueue()
  while (q.length) {
    const { error } = await supabase.rpc('submit_sale', { payload: q[0] })
    if (error) break
    q = q.slice(1)
    await set(QUEUE, q)
  }
  return q.length
}

export async function loadProducts() {
  try {
    const { data, error } = await supabase.from('products_seller').select('*').order('name')
    if (error) throw error
    await set(PRODUCTS, data)
    return data
  } catch {
    return (await get(PRODUCTS)) || []
  }
}

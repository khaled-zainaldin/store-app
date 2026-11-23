import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './Login.jsx'
import Sales from './Sales.jsx'
import Products from './Products.jsx'
import Orders from './Orders.jsx'
import Dashboard from './Dashboard.jsx'
import Expenses from './Expenses.jsx'
import Workers from './Workers.jsx'
import Suppliers from './Suppliers.jsx'
import ExpenseReport from './ExpenseReport.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [role, setRole] = useState(null)
  const [tab, setTab] = useState('dash')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return setRole(null)
    const key = 'role:' + session.user.id
    supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => {
        const r = data?.role || localStorage.getItem(key) || 'seller'
        if (data?.role) localStorage.setItem(key, r)
        setRole(r)
      })
      .catch(() => setRole(localStorage.getItem(key) || 'seller'))
  }, [session])

  if (session === undefined) return null
  if (!session) return <Login />
  if (!role) return null

  const logout = () => supabase.auth.signOut()
  if (role !== 'admin') return <Sales onLogout={logout} />

  return (
    <>
      <nav className="tabs">
        {[['dash', 'الرئيسية'], ['sell', 'بيع'], ['orders', 'المبيعات'], ['products', 'المنتجات'], ['exp', 'المصاريف'], ['sup', 'التجار'], ['rep', 'تقرير المصاريف'], ['workers', 'العمال']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      {tab === 'dash' && <Dashboard />}
      {tab === 'exp' && <Expenses />}
      {tab === 'rep' && <ExpenseReport />}
      {tab === 'sup' && <Suppliers />}
      {tab === 'workers' && <Workers />}
      {tab === 'sell' && <Sales onLogout={logout} />}
      {tab === 'orders' && <Orders />}
      {tab === 'products' && <Products />}
    </>
  )
}

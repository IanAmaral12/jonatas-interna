import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { preAppointmentInputValue, preAppointmentTimestamp } from '../lib/preAppointments'

const pageSize = 25
const expiryFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})
function todayValue() {
  return preAppointmentInputValue(new Date())
}
function formatDate(value) {
  return expiryFormatter.format(new Date(value))
}

export default function PreAppointmentsPage() {
  const [sellers, setSellers] = useState([])
  const [entries, setEntries] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ seller_id: '', quantity: '', appointment_at: todayValue() })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [entryToDelete, setEntryToDelete] = useState(null)
  const dialogRef = useRef(null)
  const busyRef = useRef(false)

  useEffect(() => {
    let active = true
    const loadEntries = async () => {
      setLoading(true)
      setLoadError('')
      try {
        const [sellerResult, { data, error, count: total }] = await Promise.all([
          supabase.rpc('get_dashboard_sellers'),
          supabase
            .from('pre_appointments')
            .select('id,seller_id,quantity,appointment_at,expires_at', { count: 'exact' })
            .order('appointment_at', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id')
            .range(page * pageSize, (page + 1) * pageSize - 1),
        ])
        if (!active) return
        if (sellerResult.error)
          setLoadError('Não foi possível carregar os vendedores. Tente novamente.')
        else setSellers(sellerResult.data || [])
        if (error) {
          setLoadError('Não foi possível carregar os pré-agendamentos.')
          setEntries([])
        } else {
          setCount(total || 0)
          if (page > 0 && !data?.length) setPage((current) => current - 1)
          setEntries(data || [])
        }
      } catch {
        if (active) setLoadError('Falha de conexão. Tente novamente.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadEntries()
    return () => {
      active = false
    }
  }, [page, revision])

  // Refresh while open so expiration is reflected without reloading the page.
  useEffect(() => {
    const timer = window.setInterval(() => setRevision((value) => value + 1), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!modal && !entryToDelete) return undefined
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    const focusables = () => [
      ...dialog.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
      ),
    ]
    focusables()[0]?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape' && !busyRef.current) {
        setModal(null)
        setEntryToDelete(null)
      }
      if (event.key === 'Tab') {
        const items = focusables()
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previousFocus?.focus()
    }
  }, [modal, entryToDelete])

  const sellerName = (id) =>
    sellers.find((seller) => seller.id === id)?.name || 'Vendedor não disponível'
  const openForm = (entry = null) => {
    setFormError('')
    setForm(
      entry
        ? {
            seller_id: entry.seller_id,
            quantity: String(entry.quantity),
            appointment_at: preAppointmentInputValue(entry.appointment_at),
          }
        : { seller_id: sellers[0]?.id || '', quantity: '', appointment_at: todayValue() },
    )
    setModal(entry || 'new')
  }
  const refresh = () => {
    setLoadError('')
    setRevision((value) => value + 1)
  }
  const saveEntry = async (event) => {
    event.preventDefault()
    if (busyRef.current) return
    const quantity = Number(form.quantity)
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000000 ||
      !form.seller_id ||
      !preAppointmentTimestamp(form.appointment_at)
    ) {
      setFormError('Selecione vendedor, data e hora e uma quantidade inteira maior que zero.')
      return
    }
    busyRef.current = true
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        ...form,
        quantity,
        appointment_at: preAppointmentTimestamp(form.appointment_at),
      }
      const query =
        modal === 'new'
          ? supabase.from('pre_appointments').insert(payload)
          : supabase.from('pre_appointments').update(payload).eq('id', modal.id)
      const { data, error } = await query.select('id')
      if (error) setFormError('Não foi possível salvar. Verifique os dados e tente novamente.')
      else if (!data?.length)
        setFormError('Este lançamento expirou ou foi excluído. Atualize a lista.')
      else {
        setModal(null)
        refresh()
      }
    } catch {
      setFormError('Falha de conexão. Tente novamente.')
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }
  const deleteEntry = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setSaving(true)
    setFormError('')
    try {
      const { error } = await supabase.from('pre_appointments').delete().eq('id', entryToDelete.id)
      if (error) setFormError('Não foi possível excluir. Tente novamente.')
      else {
        setEntryToDelete(null)
        refresh()
      }
    } catch {
      setFormError('Falha de conexão. Tente novamente.')
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  return (
    <section className="dashboard-content pre-appointments-page" aria-label="Pré-agendamentos">
      <header className="dashboard-header">
        <div>
          <span className="dashboard-eyebrow">Planejamento comercial</span>
          <h1>Pré-agendamentos</h1>
          <p>
            Lance quantidades por vendedor, data e hora para acompanhar o potencial da operação.
          </p>
        </div>
        <span className="pre-retention-badge">
          <CalendarDays size={16} /> Validade de 15 dias
        </span>
      </header>
      {loadError && (
        <div className="dashboard-alert error" role="alert">
          <AlertTriangle size={18} />
          {loadError}
          <button className="cash-modal-cancel" type="button" onClick={refresh}>
            Tentar novamente
          </button>
        </div>
      )}
      <article className="cash-history-panel">
        <div className="cash-panel-heading cash-history-heading">
          <div>
            <span>Registro temporário</span>
            <h2>Lançamentos de pré-agendamentos</h2>
          </div>
          <button
            className="cash-new-entry-button"
            type="button"
            disabled={!sellers.length}
            onClick={() => openForm()}
          >
            <Plus size={17} /> Novo lançamento
          </button>
        </div>
        <p className="pre-retention-note">
          Cada lançamento expira 15 dias após sua criação e é excluído automaticamente. Editar não
          renova a validade.
        </p>
        <div className="cash-history-scroll">
          {loading ? (
            <div className="cash-empty-state">
              <LoaderCircle size={24} className="spin" />
              Carregando lançamentos...
            </div>
          ) : entries.length === 0 ? (
            <div className="cash-empty-state">
              <CalendarDays size={30} />
              <strong>Nenhum pré-agendamento</strong>
              <span>Clique em Novo lançamento para registrar uma quantidade.</span>
            </div>
          ) : (
            <table className="pre-table">
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Vendedor</th>
                  <th>Pré-agendamentos</th>
                  <th>Expira em</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label="Data e hora">{formatDate(entry.appointment_at)}</td>
                    <td data-label="Vendedor" className="pre-seller-cell">
                      {sellerName(entry.seller_id)}
                    </td>
                    <td data-label="Pré-agendamentos" className="pre-quantity">
                      {entry.quantity}
                    </td>
                    <td data-label="Expira em">
                      {expiryFormatter.format(new Date(entry.expires_at))}
                    </td>
                    <td>
                      <div className="pre-row-actions">
                        <button
                          type="button"
                          title="Editar lançamento"
                          aria-label={`Editar lançamento de ${sellerName(entry.seller_id)} em ${formatDate(entry.appointment_at)}`}
                          onClick={() => openForm(entry)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          title="Excluir lançamento"
                          aria-label={`Excluir lançamento de ${sellerName(entry.seller_id)} em ${formatDate(entry.appointment_at)}`}
                          onClick={() => {
                            setFormError('')
                            setEntryToDelete(entry)
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="pre-pagination">
          <span>
            {count} {count === 1 ? 'lançamento ativo' : 'lançamentos ativos'}
          </span>
          <div>
            <button
              type="button"
              aria-label="Página anterior"
              disabled={loading || page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              Página {page + 1} de {Math.max(1, Math.ceil(count / pageSize))}
            </span>
            <button
              type="button"
              aria-label="Próxima página"
              disabled={loading || (page + 1) * pageSize >= count}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </article>
      {(modal || entryToDelete) && (
        <div
          className="cash-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setModal(null)
              setEntryToDelete(null)
            }
          }}
        >
          <div
            ref={dialogRef}
            className={`cash-modal${entryToDelete ? ' cash-delete-modal' : ''}`}
            role={entryToDelete ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="pre-modal-title"
          >
            {entryToDelete ? (
              <>
                <div className="cash-delete-icon">
                  <Trash2 size={21} />
                </div>
                <h2 id="pre-modal-title">Excluir pré-agendamento?</h2>
                <p>
                  {entryToDelete.quantity} pré-agendamentos de {sellerName(entryToDelete.seller_id)}
                  , em {formatDate(entryToDelete.appointment_at)}, serão removidos das contagens.
                </p>
                {formError && (
                  <div className="cash-flow-message error" role="alert">
                    {formError}
                  </div>
                )}
                <div className="cash-modal-actions">
                  <button
                    className="cash-modal-cancel"
                    type="button"
                    disabled={saving}
                    onClick={() => setEntryToDelete(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    className="cash-delete-confirm"
                    type="button"
                    disabled={saving}
                    onClick={deleteEntry}
                  >
                    {saving ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}
                    {saving ? 'Excluindo...' : 'Sim, excluir'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="cash-modal-header">
                  <div>
                    <span>Planejamento comercial</span>
                    <h2 id="pre-modal-title">
                      {modal === 'new' ? 'Novo pré-agendamento' : 'Editar pré-agendamento'}
                    </h2>
                  </div>
                  <button
                    type="button"
                    aria-label="Fechar"
                    disabled={saving}
                    onClick={() => setModal(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <form className="cash-entry-form" onSubmit={saveEntry}>
                  {formError && (
                    <div className="cash-flow-message error" role="alert">
                      {formError}
                    </div>
                  )}
                  <div className="cash-field">
                    <label htmlFor="pre-quantity">Quantidade de pré-agendamentos</label>
                    <input
                      id="pre-quantity"
                      type="number"
                      min="1"
                      max="1000000"
                      step="1"
                      inputMode="numeric"
                      required
                      value={form.quantity}
                      onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                    />
                  </div>
                  <div className="cash-field">
                    <label htmlFor="pre-seller">Nome do vendedor</label>
                    <select
                      id="pre-seller"
                      required
                      value={form.seller_id}
                      onChange={(event) => setForm({ ...form, seller_id: event.target.value })}
                    >
                      <option value="" disabled>
                        Selecione um vendedor
                      </option>
                      {!sellers.some((seller) => seller.id === form.seller_id) &&
                        form.seller_id && (
                          <option value={form.seller_id}>Vendedor inativo (selecione outro)</option>
                        )}
                      {sellers.map((seller) => (
                        <option key={seller.id} value={seller.id}>
                          {seller.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="cash-field">
                    <label htmlFor="pre-date">Data e hora</label>
                    <input
                      id="pre-date"
                      type="datetime-local"
                      step="60"
                      required
                      value={form.appointment_at}
                      onChange={(event) => setForm({ ...form, appointment_at: event.target.value })}
                    />
                    <small className="pre-timezone-note">
                      Horário de Brasília. Toda a quantidade será contabilizada neste horário,
                      inclusive nos marcos.
                    </small>
                  </div>
                  <small className="pre-retention-note">
                    {modal === 'new'
                      ? 'Válido por 15 dias após salvar.'
                      : `Validade mantida até ${expiryFormatter.format(new Date(modal.expires_at))}.`}
                  </small>
                  <div className="cash-modal-actions">
                    <button
                      className="cash-modal-cancel"
                      type="button"
                      disabled={saving}
                      onClick={() => setModal(null)}
                    >
                      Cancelar
                    </button>
                    <button className="cash-submit-button" type="submit" disabled={saving}>
                      {saving ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}
                      {saving ? 'Salvando...' : 'Salvar lançamento'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

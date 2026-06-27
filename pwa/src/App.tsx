import { Navigate, Route, Router } from '@solidjs/router'
import type { JSX } from 'solid-js'
import BottomNav from './components/BottomNav'
import Food from './routes/Food'
import FoodHistory from './routes/FoodHistory'
import NoteCreate from './routes/NoteCreate'
import NoteEditor from './routes/NoteEditor'
import NoteHistory from './routes/NoteHistory'
import Settings from './routes/Settings'
import styles from './App.module.css'

function Shell(props: { children?: JSX.Element }) {
  return (
    <div class={styles.shell}>
      <main class={styles.content}>{props.children}</main>
      <BottomNav />
    </div>
  )
}

function App() {
  return (
    <Router root={Shell} base={import.meta.env.BASE_URL}>
      <Route path="/" component={() => <Navigate href="/notes" />} />
      <Route path="/notes" component={NoteCreate} />
      <Route path="/notes/history" component={NoteHistory} />
      <Route path="/notes/:id" component={NoteEditor} />
      <Route path="/food" component={Food} />
      <Route path="/food/history" component={FoodHistory} />
      <Route path="/settings" component={Settings} />
    </Router>
  )
}

export default App

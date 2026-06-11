import { Route, Router } from '@solidjs/router'
import type { JSX } from 'solid-js'
import BottomNav from './components/BottomNav'
import Home from './routes/Home'
import List from './routes/List'
import NoteEditor from './routes/NoteEditor'
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
    <Router root={Shell}>
      <Route path="/" component={Home} />
      <Route path="/notes" component={List} />
      <Route path="/notes/:id" component={NoteEditor} />
    </Router>
  )
}

export default App

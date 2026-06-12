import { Route, Router } from '@solidjs/router'
import type { JSX } from 'solid-js'
import BottomNav from './components/BottomNav'
import Home from './routes/Home'
import List from './routes/List'
import NoteEditor from './routes/NoteEditor'
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
    <Router root={Shell} base="/tag-notes/">
      <Route path="/" component={Home} />
      <Route path="/notes" component={List} />
      <Route path="/notes/:id" component={NoteEditor} />
      <Route path="/settings" component={Settings} />
    </Router>
  )
}

export default App

import { useParams } from '@solidjs/router'

function NoteEditor() {
  const params = useParams()

  return <div>Note editor for {params.id} (plan 5)</div>
}

export default NoteEditor

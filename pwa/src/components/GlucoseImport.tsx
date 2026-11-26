import { createSignal, Match, Switch } from 'solid-js';
import { importGlucose } from '../lib/account';
import { errorMessage } from '../lib/api';
import { InvalidGlucoseCsvError, parseLibreViewCsv, type ParsedGlucoseCsv } from '../lib/glucose/csv';
import Button from './Button';
import Message from './Message';
import styles from './GlucoseImport.module.css';

/** Readings per request; the route takes up to 500. Lower it if `wrangler tail` shows requests near 10 ms of CPU. */
const CHUNK = 500;

type State =
  | { step: 'idle' }
  | { step: 'reading' }
  | { step: 'preview'; parsed: ParsedGlucoseCsv; timeZone: string }
  | { step: 'importing'; sent: number; total: number };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '–');
const count = (n: number) => n.toLocaleString();

/** Plan 17: Settings → Glucose → import a LibreView CSV export, parsed here and posted in chunks. */
function GlucoseImport() {
  const [state, setState] = createSignal<State>({ step: 'idle' });
  const [status, setStatus] = createSignal<{ kind: 'error' | 'success'; message: string }>();
  let fileInput: HTMLInputElement | undefined;

  const handleFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setStatus(undefined);
    setState({ step: 'reading' });
    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const parsed = parseLibreViewCsv(await file.text(), timeZone);
      if (parsed.readings.length === 0) {
        setState({ step: 'idle' });
        setStatus({ kind: 'error', message: 'No glucose readings in that file.' });
        return;
      }
      setState({ step: 'preview', parsed, timeZone });
    } catch (err) {
      setState({ step: 'idle' });
      setStatus({ kind: 'error', message: err instanceof InvalidGlucoseCsvError ? err.message : 'Could not read that file.' });
    }
  };

  const handleImport = async (parsed: ParsedGlucoseCsv) => {
    const { readings } = parsed;
    let inserted = 0;
    let duplicates = 0;
    setState({ step: 'importing', sent: 0, total: readings.length });
    try {
      for (let i = 0; i < readings.length; i += CHUNK) {
        const result = await importGlucose(readings.slice(i, i + CHUNK));
        inserted += result.inserted;
        duplicates += result.duplicates;
        setState({ step: 'importing', sent: Math.min(i + CHUNK, readings.length), total: readings.length });
      }
      setStatus({ kind: 'success', message: `Imported ${count(inserted)} readings; ${count(duplicates)} were already stored.` });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: `${errorMessage(err)} Stopped after ${count(inserted + duplicates)} readings; import the same file again to finish (stored readings are skipped).`,
      });
    } finally {
      setState({ step: 'idle' });
    }
  };

  return (
    <div class={styles.root}>
      <Switch>
        <Match when={state().step === 'idle' || state().step === 'reading'}>
          <Button variant="tinted" disabled={state().step === 'reading'} onClick={() => fileInput?.click()}>
            {state().step === 'reading' ? 'Reading…' : 'Import LibreView CSV…'}
          </Button>
        </Match>
        <Match when={state().step === 'preview' && (state() as Extract<State, { step: 'preview' }>)}>
          {(preview) => (
            <>
              <p class={styles.text}>
                {count(preview().parsed.historic)} readings and {count(preview().parsed.scans)} scans, {day(preview().parsed.first)} to{' '}
                {day(preview().parsed.last)}, times in {preview().timeZone}.
                {preview().parsed.skipped > 0 ? ` ${count(preview().parsed.skipped)} rows skipped.` : ''}
              </p>
              <div class={styles.actions}>
                <Button variant="gray" onClick={() => setState({ step: 'idle' })}>
                  Cancel
                </Button>
                <Button onClick={() => void handleImport(preview().parsed)}>Import</Button>
              </div>
            </>
          )}
        </Match>
        <Match when={state().step === 'importing' && (state() as Extract<State, { step: 'importing' }>)}>
          {(progress) => (
            <p class={styles.text} role="status">
              Importing… {count(progress().sent)} of {count(progress().total)}
            </p>
          )}
        </Match>
      </Switch>
      <input ref={fileInput} type="file" accept=".csv,text/csv" class={styles.hiddenInput} onChange={(event) => void handleFile(event)} />
      <Message kind={status()?.kind ?? 'success'} text={status()?.message} />
    </div>
  );
}

export default GlucoseImport;

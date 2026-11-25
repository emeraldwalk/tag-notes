import { onCleanup } from 'solid-js';
import type { Medicine } from '../lib/meds/types';
import styles from './MedicineButton.module.css';

const LONG_PRESS_MS = 500;

export interface MedicineButtonProps {
  medicine: Medicine;
  disabled?: boolean;
  /** A tap: log it now. */
  onTap: () => void;
  /** A long press or "…": choose the time or dose first. */
  onMore: () => void;
}

/** One medicine on the Meds tab: tap logs it now; long press or "…" opens the sheet. */
function MedicineButton(props: MedicineButtonProps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  onCleanup(cancel);

  const handlePointerDown = () => {
    longPressed = false;
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      longPressed = true;
      props.onMore();
    }, LONG_PRESS_MS);
  };

  const handleClick = () => {
    cancel();
    // The click that ends a long press isn't a tap.
    if (longPressed) {
      longPressed = false;
      return;
    }
    props.onTap();
  };

  return (
    <div class={styles.root}>
      <button
        type="button"
        class={styles.main}
        disabled={props.disabled}
        onPointerDown={handlePointerDown}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onClick={handleClick}
      >
        <span class={styles.name}>{props.medicine.name}</span>
        <span class={styles.dose}>{props.medicine.defaultDose ?? ''}</span>
      </button>
      <button
        type="button"
        class={styles.more}
        aria-label={`${props.medicine.name}: choose time or dose`}
        onClick={() => props.onMore()}
      >
        …
      </button>
    </div>
  );
}

export default MedicineButton;

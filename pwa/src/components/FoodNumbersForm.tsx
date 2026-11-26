import { createSignal } from 'solid-js';
import type { FoodNumbers } from '../lib/inbox/types';
import { formatEntryTime } from '../lib/inbox/time';
import Button from './Button';
import Field from './Field';
import styles from './FoodNumbersForm.module.css';

export interface FoodNumbersFormProps {
  name: string;
  quantity: number;
  /** The time captured from the entry; the food entry gets it, whenever this is saved. */
  eatenAt: string;
  disabled: boolean;
  onSave: (food: FoodNumbers) => void;
  onCancel: () => void;
}

const number = (value: string) => (value.trim() === '' ? NaN : Number(value));

/** Plan 10: the numbers for a food I haven't logged before ("Needs numbers"), per serving as on the Food tab. */
function FoodNumbersForm(props: FoodNumbersFormProps) {
  const [name, setName] = createSignal(props.name);
  const [servingSize, setServingSize] = createSignal('');
  const [quantity, setQuantity] = createSignal(String(props.quantity));
  const [protein, setProtein] = createSignal('');
  const [calories, setCalories] = createSignal('');
  const [carbs, setCarbs] = createSignal('');

  const values = () => ({ quantity: number(quantity()), protein: number(protein()), calories: number(calories()), carbs: number(carbs()) });
  const valid = () => {
    const v = values();
    return name().trim() !== '' && v.quantity > 0 && v.protein >= 0 && v.calories >= 0 && v.carbs >= 0;
  };

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    if (!valid() || props.disabled) return;
    const food: FoodNumbers = { name: name().trim(), ...values() };
    if (servingSize().trim()) food.servingSize = servingSize().trim();
    props.onSave(food);
  };

  return (
    <form class={styles.form} onSubmit={handleSubmit}>
      <p class={styles.when}>Eaten {formatEntryTime(props.eatenAt)}</p>
      <div class={styles.grid2}>
        <Field label="Name">
          <input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label="Serving size">
          <input placeholder="1 slice" value={servingSize()} onInput={(e) => setServingSize(e.currentTarget.value)} />
        </Field>
      </div>
      <div class={styles.grid4}>
        <Field label="Servings">
          <input type="number" inputmode="decimal" value={quantity()} onInput={(e) => setQuantity(e.currentTarget.value)} />
        </Field>
        <Field label="Protein (g)">
          <input type="number" inputmode="decimal" value={protein()} onInput={(e) => setProtein(e.currentTarget.value)} />
        </Field>
        <Field label="Calories">
          <input type="number" inputmode="decimal" value={calories()} onInput={(e) => setCalories(e.currentTarget.value)} />
        </Field>
        <Field label="Carbs (g)">
          <input type="number" inputmode="decimal" value={carbs()} onInput={(e) => setCarbs(e.currentTarget.value)} />
        </Field>
      </div>
      <p class={styles.hint}>Protein, calories and carbs are per serving.</p>
      <div class={styles.actions}>
        <Button variant="gray" small onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Button type="submit" small disabled={!valid() || props.disabled}>
          Save Food
        </Button>
      </div>
    </form>
  );
}

export default FoodNumbersForm;

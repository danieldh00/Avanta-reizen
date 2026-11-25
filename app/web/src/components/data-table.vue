<!--
  Lijst als tabel, gelijk aan `renderTable` uit `app/src/crm/ui.js`: op een smal scherm een kaart per rij (via
  `data-label` en de klassen uit `crm.css`), met expliciete rollen zodat een schermlezer de kolomnamen ook in de
  kaartweergave voorleest. Een cel is standaard de tekst van `row[kolom.key]`; een eigen weergave via de slot
  `cel-<sleutel>` (bijvoorbeeld een link of een status).
-->
<script setup lang="ts" generic="Row extends Record<string, unknown>">
/** Eén kolom van de lijst. */
export interface TableColumn {
  /** Sleutel van de waarde in de rij en naam van de slot (`cel-<sleutel>`). */
  key: string;
  /** Kop van de kolom (en label in de kaartweergave). */
  label: string;
  /** Getallen rechts uitlijnen. */
  numeric?: boolean;
  /** Lange tekst laten afbreken. */
  wrap?: boolean;
}

const props = defineProps<{
  columns: TableColumn[];
  rows: Row[];
  /** Tekst als de lijst leeg is. */
  empty: string;
  /** Onzichtbaar bijschrift voor schermlezers. */
  caption?: string;
  /** Sleutel van een rij voor Vue (standaard `id`). */
  rowKey?: string;
}>();

/**
 * De klassen van een cel in een kolom.
 * @param column Kolom.
 * @returns Klassen.
 */
function cellClass(column: TableColumn): string[] {
  return [column.numeric ? 'crm-num' : '', column.wrap ? 'crm-wrap' : ''].filter(Boolean);
}

/**
 * Sleutel van een rij: het veld `rowKey` (standaard `id`), anders de plaats in de lijst.
 * @param row Rij.
 * @param index Plaats.
 * @returns Sleutel.
 */
function keyOf(row: Row, index: number): string | number {
  const value = row[props.rowKey || 'id'];
  return typeof value === 'string' || typeof value === 'number' ? value : index;
}
</script>

<template>
  <p
    v-if="!rows.length"
    class="crm-empty"
  >
    {{ empty }}
  </p>
  <div
    v-else
    class="crm-table-wrap crm-table-wrap--cards"
  >
    <table
      class="crm-table crm-table--cards"
      role="table"
    >
      <caption
        v-if="caption"
        class="visually-hidden"
      >
        {{ caption }}
      </caption>
      <thead role="rowgroup">
        <tr role="row">
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            role="columnheader"
            :class="cellClass(column)"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        <tr
          v-for="(row, index) in rows"
          :key="keyOf(row, index)"
          role="row"
        >
          <td
            v-for="column in columns"
            :key="column.key"
            role="cell"
            :data-label="column.label"
            :class="cellClass(column)"
          >
            <slot
              :name="`cel-${column.key}`"
              :row="row"
            >
              {{ row[column.key] ?? '' }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

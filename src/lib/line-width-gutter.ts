import { RangeSet, StateField, type Text } from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";

/** Lines longer than this get a subtle gutter hint (no auto-wrapping). */
export const LINE_WIDTH_LIMIT = 100;

class TooLongMarker extends GutterMarker {
  override elementClass = "cm-line-too-long";
}

const marker = new TooLongMarker();

function computeLongLines(doc: Text): RangeSet<GutterMarker> {
  const ranges: { from: number; to: number; value: GutterMarker }[] = [];
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (line.length > LINE_WIDTH_LIMIT) {
      ranges.push(marker.range(line.from));
    }
  }
  return RangeSet.of(ranges);
}

const longLinesField = StateField.define<RangeSet<GutterMarker>>({
  create: (state) => computeLongLines(state.doc),
  update(value, tr) {
    return tr.docChanged ? computeLongLines(tr.state.doc) : value;
  },
});

/** Marks overlong lines in the gutter (see .cm-line-too-long in index.css). */
export const lineWidthGutter = [
  longLinesField,
  gutterLineClass.compute([longLinesField], (state) => state.field(longLinesField)),
];

import {
  cloneElement,
  Fragment,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Text, View, type ColorValue, type ViewStyle } from 'react-native';
import { Renderer, useMarkdown, type MarkedStyles } from 'react-native-marked';

import { colors, fonts } from '@/theme';
import { CollapsibleSection } from '../genui/components/CollapsibleSection';
import { parseBlocks, type Block } from '../genui/htmlSections.ts';

export type AssistantMarkdownProps = {
  text: string;
  streaming?: boolean;
  /**
   * Draws the tool call (card) whose marker (`<!--ano:tcN-->`) stands at this place in the text.
   * Without it markers render nothing.
   */
  renderToolCall?: (index: number) => ReactNode;
};

/** Minimum time between re-parses while a message is still streaming. */
const PARSE_INTERVAL_MS = 60;

// Colors are the exported Ano tokens, so no type annotation is needed here.
const markdownTheme = {
  colors: {
    text: colors.ink,
    link: colors.accent,
    border: colors.border,
    code: colors.fill,
  },
};

/**
 * Ano styling for the parsed blocks. These override the library defaults, so
 * properties the defaults set (h1 border, code font, italic links) are repeated
 * here where they must not leak through.
 */
const markdownStyles: MarkedStyles = {
  text: { fontSize: 16, lineHeight: 23, color: colors.ink },
  // 5 + 5 top/bottom padding gives a 10px gap between adjacent paragraphs.
  paragraph: { paddingVertical: 5 },
  // Inline styles must repeat the 23px line height: the library defaults set 24, which would
  // stretch any line that holds bold, italic, a link or inline code.
  link: {
    lineHeight: 23,
    color: colors.accent,
    textDecorationLine: 'underline',
    fontStyle: 'normal',
  },
  strong: { fontWeight: '600', lineHeight: 23 },
  em: { fontStyle: 'italic', lineHeight: 23 },
  strikethrough: { textDecorationLine: 'line-through', lineHeight: 23 },
  h1: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: fonts.rounded,
    color: colors.ink,
    marginVertical: 8,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  h2: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '600',
    color: colors.ink,
    marginVertical: 8,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  h3: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.ink,
    marginVertical: 6,
    paddingBottom: 0,
    borderBottomWidth: 0,
  },
  h4: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.ink,
    marginVertical: 4,
  },
  h5: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.ink,
    marginVertical: 4,
  },
  h6: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.ink,
    marginVertical: 4,
  },
  codespan: {
    fontFamily: fonts.mono,
    fontSize: 14,
    lineHeight: 23,
    color: colors.ink,
    backgroundColor: colors.fill,
    fontStyle: 'normal',
    fontWeight: '400',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  code: {
    backgroundColor: colors.fill,
    padding: 12,
    borderRadius: 12,
    minWidth: '100%',
  },
  codeText: {
    fontFamily: fonts.mono,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  blockquote: {
    borderLeftColor: colors.border,
    borderLeftWidth: 3,
    paddingLeft: 12,
    opacity: 1, // text is tinted to secondary ink by the renderer below
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    marginVertical: 8,
  },
  list: { paddingRight: 6 },
  li: { fontSize: 16, lineHeight: 23, color: colors.ink },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tableCell: { padding: 8 },
  image: { resizeMode: 'cover' },
};

/**
 * Recursively repaint every Text node in an already rendered tree. React Native
 * does not inherit `color` from a View, so a blockquote's border View cannot tint
 * its text. This walks the tree and injects the color into each Text instead.
 */
function repaintText(node: ReactNode, color: ColorValue): ReactNode {
  if (Array.isArray(node)) {
    return node.map((child) => repaintText(child, color));
  }
  if (!isValidElement(node)) {
    return node;
  }
  const element = node as ReactElement<{ style?: unknown; children?: ReactNode }>;
  if (element.type === Text) {
    return cloneElement(element, { style: [element.props.style, { color }] });
  }
  if (element.props.children != null) {
    return cloneElement(element, {
      children: repaintText(element.props.children, color),
    });
  }
  return element;
}

/** 6px gap between list items, kept off the shared `li` marker style. */
const listItemGap: ViewStyle = { marginBottom: 6 };

class AnoRenderer extends Renderer {
  constructor() {
    super({ selectable: true });
  }

  override blockquote(children: ReactNode[], styles?: ViewStyle): ReactNode {
    return (
      <View key={this.getKey()} style={styles}>
        {repaintText(children, colors.inkSecondary)}
      </View>
    );
  }

  override listItem(children: ReactNode[], styles?: ViewStyle): ReactNode {
    return (
      <View key={this.getKey()} style={[styles, listItemGap]}>
        {children}
      </View>
    );
  }
}

// One renderer for the whole app keeps parsing memoized and text selectable.
const renderer = new AnoRenderer();

/** One run of markdown, parsed off the throttled text. */
function MarkdownPiece({ text, streaming }: { text: string; streaming: boolean }) {
  // While streaming, close an unterminated fenced code block so a half-streamed
  // ``` block does not swallow the rest of the message into one giant code span.
  const openFenceCount = streaming ? text.split('```').length - 1 : 0;
  const safeText = streaming && openFenceCount % 2 === 1 ? text + '\n```' : text;

  // Non-virtualized path: useMarkdown returns plain elements rendered into a
  // single View, so there is no internal FlatList scrolling here.
  const elements = useMarkdown(safeText, {
    colorScheme: 'light',
    renderer,
    styles: markdownStyles,
    theme: markdownTheme,
  });

  return (
    <View accessible accessibilityRole="text" accessibilityLabel={`Ano said: ${text}`}>
      {elements.map((element, index) => (
        <Fragment key={index}>{element}</Fragment>
      ))}
    </View>
  );
}

/** Blocks in document order: markdown, cards at their markers, native collapsibles for `<details>`. */
function BlockList({ blocks, streaming, renderToolCall }: { blocks: Block[]; streaming: boolean; renderToolCall?: (index: number) => ReactNode }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'markdown':
            return <MarkdownPiece key={index} text={block.text} streaming={streaming} />;
          case 'call':
            return <Fragment key={`call${block.index}:${index}`}>{renderToolCall ? renderToolCall(block.index) : null}</Fragment>;
          case 'details':
            return (
              <CollapsibleSection key={index} title={block.summary} defaultOpen={block.open}>
                <BlockList blocks={block.blocks} streaming={streaming} renderToolCall={renderToolCall} />
              </CollapsibleSection>
            );
        }
      })}
    </>
  );
}

function AssistantMarkdownInner({ text, streaming = false, renderToolCall }: AssistantMarkdownProps) {
  // The text handed to the parser; lags the live prop by at most one throttle
  // window while streaming.
  const [renderText, setRenderText] = useState(text);
  const lastParseRef = useRef(0);

  useEffect(() => {
    if (!streaming) {
      // Final frame (or a completed message): render the latest text immediately.
      lastParseRef.current = Date.now();
      setRenderText(text);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastParseRef.current;
    if (elapsed >= PARSE_INTERVAL_MS) {
      lastParseRef.current = now;
      setRenderText(text);
      return;
    }

    // Trailing edge: flush the newest text when the throttle window expires. The
    // cleanup clears this timer if a newer chunk (or the final frame) arrives first.
    const timer = setTimeout(() => {
      lastParseRef.current = Date.now();
      setRenderText(text);
    }, PARSE_INTERVAL_MS - elapsed);

    return () => clearTimeout(timer);
  }, [text, streaming]);

  const blocks = useMemo(() => parseBlocks(renderText), [renderText]);

  return (
    <View className="w-full gap-3">
      <BlockList blocks={blocks} streaming={streaming} renderToolCall={renderToolCall} />
    </View>
  );
}

export const AssistantMarkdown = memo(AssistantMarkdownInner);

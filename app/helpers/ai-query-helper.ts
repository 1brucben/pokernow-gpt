import { BotAction } from "../interfaces/ai-client-interfaces.ts";

export const playstyleToPrompt: Map<string, string> = new Map<string, string>([
  [
    "pro",
    "You are a pro poker player who plays strong ranges preflop and plays aggressively postflop.",
  ],
  [
    "aggressive",
    "You are an experienced poker player who plays aggressively like a maniac.",
  ],
  [
    "passive",
    "You are an experienced poker player who plays passively like a nit.",
  ],
  [
    "neutral",
    "You are an experienced poker player who plays strong ranges preflop, has a balanced playstyle, and calls all-ins when you have a strong hand",
  ],
  [
    "exploit",
    "You are an experienced poker player exploiting recreational opponents. Raise larger preflop, isolate weaker players, and play wider in late position when the table is short-handed. Continuation bet frequently on dry boards and stab turns often when opponents check. Apply pressure on safe or blank turns, especially after opponents show weakness.\n\nValue bet confidently when you are likely ahead and somewhat thinner in heads-up pots, but be more cautious with thin value in multiway pots or on highly coordinated boards. Bluff sparingly and avoid turning hands with reasonable showdown value into bluffs.\n\nWhen deciding on river calls, consider how the river card changes both players' likely ranges. If the river strongly improves the range of the player who called the previous street (for example completing common straights or flushes), reduce bluff-catching frequency and prefer folding medium-strength hands more often. When the river is neutral or favors your range, defend more often.\n\nPrefer betting and raising over passive play when you likely have the best hand, but avoid overly large bets with marginal hands on boards where many stronger hands are possible.\n\nAgainst very small river bets, consider raising more often when you can credibly represent strong value, as recreational players frequently make weak blocking bets.",
  ],
]);

export function getPromptFromPlaystyle(playstyle: string) {
  const prompt = playstyleToPrompt.get(playstyle);
  if (prompt !== undefined) {
    return prompt;
  }
  throw new Error("Invalid playstyle, could not get playstyle prompt.");
}

export function parseResponse(msg: string): BotAction {
  msg = processOutput(msg);

  if (!msg) {
    return {
      action_str: "",
      bet_size_in_BBs: 0,
    };
  }

  const action_matches = msg.match(/(bet|raise|call|check|fold|all.in)/);
  let action_str = "";
  if (action_matches) {
    action_str = action_matches[0];
    if (action_str.includes("in")) {
      action_str = "all-in";
    }
  }

  const bet_size_matches = msg.match(/[+]?([0-9]+(?:[\.][0-9]*)?|\.[0-9]+)/);
  let bet_size_in_BBs = 0;
  if (bet_size_matches) {
    bet_size_in_BBs = parseFloat(bet_size_matches[0]);
  }
  return {
    action_str: action_str,
    bet_size_in_BBs: bet_size_in_BBs,
  };
}

function processOutput(msg: string): string {
  msg = msg.toLowerCase();
  const start_index = msg.indexOf("{");
  const end_index = msg.indexOf("}");
  if (start_index != -1 && end_index != -1) {
    return msg.substring(start_index + 1, end_index);
  }
  return msg;
}

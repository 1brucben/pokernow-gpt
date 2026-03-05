export interface AIMessage {
  text_content: string;
  metadata: any;
}

export interface AIResponse {
  bot_action: BotAction;
  prev_messages: AIMessage[];
  curr_message: AIMessage;
}

export abstract class AIService {
  private api_key: string;
  private model_name: string;
  private playstyle: string;
  private custom_prompt: string;

  constructor(
    api_key: string,
    model: string,
    playstyle: string,
    custom_prompt: string = "",
  ) {
    this.api_key = api_key;
    this.model_name = model;
    this.playstyle = playstyle;
    this.custom_prompt = custom_prompt;
  }

  abstract init(): void;
  abstract query(input: string, prev_messages: AIMessage[]): Promise<any>;
  abstract processMessages(messages: AIMessage[]): Array<any>;

  getAPIKey(): string {
    return this.api_key;
  }

  getModelName(): string {
    return this.model_name;
  }

  getPlaystyle(): string {
    return this.playstyle;
  }

  setPlaystyle(playstyle: string): void {
    this.playstyle = playstyle;
  }

  getCustomPrompt(): string {
    return this.custom_prompt;
  }

  setCustomPrompt(prompt: string): void {
    this.custom_prompt = prompt;
  }
}

export interface BotAction {
  action_str: string;
  bet_size_in_BBs: number;
}

export const defaultCheckAction = {
  action_str: "check",
  bet_size_in_BBs: 0,
};

export const defaultFoldAction = {
  action_str: "fold",
  bet_size_in_BBs: 0,
};

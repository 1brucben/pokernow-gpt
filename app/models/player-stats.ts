export class PlayerStats {
  private player_name: string;
  private total_hands: number;
  private walks: number;
  private vpip_hands: number;
  private pfr_hands: number;

  // Post-flop stats
  private postflop_bets_raises: number;
  private postflop_calls: number;
  private postflop_checks: number;
  private cbet_opportunities: number;
  private cbet_made: number;
  private faced_cbet: number;
  private folded_to_cbet: number;
  private saw_flop: number;
  private went_to_showdown: number;

  // 3-Bet stats
  private three_bet_opportunities: number;
  private three_bet_made: number;
  private faced_three_bet: number;
  private folded_to_three_bet: number;

  //TODO: player stats should use name not id
  //should have separate table mapping name to id in db that updates everytime new id is detected for particular name
  constructor(player_name: string, player_JSON?: any) {
    this.player_name = player_name;
    if (player_JSON) {
      this.total_hands = player_JSON.total_hands;
      this.walks = player_JSON.walks;
      this.vpip_hands = player_JSON.vpip_hands;
      this.pfr_hands = player_JSON.pfr_hands;
      this.postflop_bets_raises = player_JSON.postflop_bets_raises ?? 0;
      this.postflop_calls = player_JSON.postflop_calls ?? 0;
      this.postflop_checks = player_JSON.postflop_checks ?? 0;
      this.cbet_opportunities = player_JSON.cbet_opportunities ?? 0;
      this.cbet_made = player_JSON.cbet_made ?? 0;
      this.faced_cbet = player_JSON.faced_cbet ?? 0;
      this.folded_to_cbet = player_JSON.folded_to_cbet ?? 0;
      this.saw_flop = player_JSON.saw_flop ?? 0;
      this.went_to_showdown = player_JSON.went_to_showdown ?? 0;
      this.three_bet_opportunities = player_JSON.three_bet_opportunities ?? 0;
      this.three_bet_made = player_JSON.three_bet_made ?? 0;
      this.faced_three_bet = player_JSON.faced_three_bet ?? 0;
      this.folded_to_three_bet = player_JSON.folded_to_three_bet ?? 0;
    } else {
      this.total_hands = 0;
      this.walks = 0;
      this.vpip_hands = 0;
      this.pfr_hands = 0;
      this.postflop_bets_raises = 0;
      this.postflop_calls = 0;
      this.postflop_checks = 0;
      this.cbet_opportunities = 0;
      this.cbet_made = 0;
      this.faced_cbet = 0;
      this.folded_to_cbet = 0;
      this.saw_flop = 0;
      this.went_to_showdown = 0;
      this.three_bet_opportunities = 0;
      this.three_bet_made = 0;
      this.faced_three_bet = 0;
      this.folded_to_three_bet = 0;
    }
  }

  public getName(): string {
    return this.player_name;
  }

  public getTotalHands(): number {
    return this.total_hands;
  }

  public setTotalHands(total_hands: number): void {
    this.total_hands = total_hands;
  }

  public getWalk(): number {
    return this.walks;
  }

  public incrementWalks(): void {
    this.walks += 1;
  }

  public getVPIPHands(): number {
    return this.vpip_hands;
  }

  public setVPIPHands(vpip: number): void {
    this.vpip_hands = vpip;
  }

  public computeVPIPStat(): number {
    if (this.total_hands - this.walks == 0) {
      return 0;
    }
    return (this.vpip_hands / (this.total_hands - this.walks)) * 100;
  }

  public getPFRHands(): number {
    return this.pfr_hands;
  }

  public setPFRHands(pfr: number): void {
    this.pfr_hands = pfr;
  }

  public computePFRStat(): number {
    if (this.total_hands - this.walks == 0) {
      return 0;
    }
    return (this.pfr_hands / (this.total_hands - this.walks)) * 100;
  }

  // --- Post-flop stat getters/setters ---

  public getPostflopBetsRaises(): number {
    return this.postflop_bets_raises;
  }
  public addPostflopBetsRaises(count: number): void {
    this.postflop_bets_raises += count;
  }

  public getPostflopCalls(): number {
    return this.postflop_calls;
  }
  public addPostflopCalls(count: number): void {
    this.postflop_calls += count;
  }

  public getPostflopChecks(): number {
    return this.postflop_checks;
  }
  public addPostflopChecks(count: number): void {
    this.postflop_checks += count;
  }

  public getThreeBetOpportunities(): number {
    return this.three_bet_opportunities;
  }
  public incrementThreeBetOpportunities(): void {
    this.three_bet_opportunities += 1;
  }

  public getThreeBetMade(): number {
    return this.three_bet_made;
  }
  public incrementThreeBetMade(): void {
    this.three_bet_made += 1;
  }

  public getFacedThreeBet(): number {
    return this.faced_three_bet;
  }
  public incrementFacedThreeBet(): void {
    this.faced_three_bet += 1;
  }

  public getFoldedToThreeBet(): number {
    return this.folded_to_three_bet;
  }
  public incrementFoldedToThreeBet(): void {
    this.folded_to_three_bet += 1;
  }

  public getCbetOpportunities(): number {
    return this.cbet_opportunities;
  }
  public incrementCbetOpportunities(): void {
    this.cbet_opportunities += 1;
  }

  public getCbetMade(): number {
    return this.cbet_made;
  }
  public incrementCbetMade(): void {
    this.cbet_made += 1;
  }

  public getFacedCbet(): number {
    return this.faced_cbet;
  }
  public incrementFacedCbet(): void {
    this.faced_cbet += 1;
  }

  public getFoldedToCbet(): number {
    return this.folded_to_cbet;
  }
  public incrementFoldedToCbet(): void {
    this.folded_to_cbet += 1;
  }

  public getSawFlop(): number {
    return this.saw_flop;
  }
  public incrementSawFlop(): void {
    this.saw_flop += 1;
  }

  public getWentToShowdown(): number {
    return this.went_to_showdown;
  }
  public incrementWentToShowdown(): void {
    this.went_to_showdown += 1;
  }

  // --- Computed post-flop stats ---

  /** Aggression Factor = (bets + raises) / calls. Returns 0 if no calls. */
  public computeAF(): number {
    if (this.postflop_calls === 0) {
      return this.postflop_bets_raises > 0 ? 999 : 0;
    }
    return this.postflop_bets_raises / this.postflop_calls;
  }

  /** C-Bet % = c-bets made / c-bet opportunities * 100 */
  public computeCBetStat(): number {
    if (this.cbet_opportunities === 0) {
      return 0;
    }
    return (this.cbet_made / this.cbet_opportunities) * 100;
  }

  /** Fold to C-Bet % = folded to c-bet / times faced c-bet * 100 */
  public computeFoldToCBetStat(): number {
    if (this.faced_cbet === 0) {
      return 0;
    }
    return (this.folded_to_cbet / this.faced_cbet) * 100;
  }

  /** WTSD % = went to showdown / saw flop * 100 */
  public computeWTSDStat(): number {
    if (this.saw_flop === 0) {
      return 0;
    }
    return (this.went_to_showdown / this.saw_flop) * 100;
  }

  /** 3-Bet % = 3-bets made / 3-bet opportunities * 100 */
  public computeThreeBetStat(): number {
    if (this.three_bet_opportunities === 0) {
      return 0;
    }
    return (this.three_bet_made / this.three_bet_opportunities) * 100;
  }

  /** Fold to 3-Bet % = folded to 3-bet / times faced 3-bet * 100 */
  public computeFoldToThreeBetStat(): number {
    if (this.faced_three_bet === 0) {
      return 0;
    }
    return (this.folded_to_three_bet / this.faced_three_bet) * 100;
  }

  /** AFq (Aggression Frequency) = (bets+raises) / (bets+raises+calls+checks) * 100 */
  public computeAFq(): number {
    const total =
      this.postflop_bets_raises + this.postflop_calls + this.postflop_checks;
    if (total === 0) {
      return 0;
    }
    return (this.postflop_bets_raises / total) * 100;
  }

  public toJSON(): any {
    return {
      name: this.player_name,
      total_hands: this.total_hands,
      walks: this.walks,
      vpip_hands: this.vpip_hands,
      pfr_hands: this.pfr_hands,
      postflop_bets_raises: this.postflop_bets_raises,
      postflop_calls: this.postflop_calls,
      cbet_opportunities: this.cbet_opportunities,
      cbet_made: this.cbet_made,
      faced_cbet: this.faced_cbet,
      folded_to_cbet: this.folded_to_cbet,
      saw_flop: this.saw_flop,
      went_to_showdown: this.went_to_showdown,
      three_bet_opportunities: this.three_bet_opportunities,
      three_bet_made: this.three_bet_made,
      faced_three_bet: this.faced_three_bet,
      folded_to_three_bet: this.folded_to_three_bet,
      postflop_checks: this.postflop_checks,
    };
  }
}

// OmeggaBucks Currency Plugin
module.exports = class Plugin {
  constructor(omegga, config, store) {
    this.omegga = omegga;
    this.config = config || {}; // Ensure config is always an object
    this.store = store;

    // Persistent balances
    this.balances = {}; 
    
    // In-memory mapping for temporary 2-digit IDs
    this.playerTempIds = {}; 
    this.tempIdToPlayerId = {};
    this.availableTempIds = new Set();
    for (let i = 1; i <= 99; i++) {
        this.availableTempIds.add(String(i).padStart(2, '0')); // "01", "02", ..., "99"
    }

    // NEW: Store for interactive bricks
    // Key: "x,y,z" (unique identifier for the brick's position)
    // Value: { type: 'shop', itemId: 'item_name', price: 100, brickOwnerId: 'brick_owner_id' }
    this.interactiveBricks = {}; 

    // Bind 'this' context for command handlers
    this.handleBucksCommand = this.handleBucksCommand.bind(this);
    this.handleBalanceCommand = this.handleBalanceCommand.bind(this);
    this.handlePayCommand = this.handlePayCommand.bind(this);
    this.handleRequestCommand = this.handleRequestCommand.bind(this);
    this.handleHelpCommand = this.handleHelpCommand.bind(this);
    this.handleIdCommand = this.handleIdCommand.bind(this);
    this.handlePlayerJoin = this.handlePlayerJoin.bind(this);
    this.handlePlayerLeave = this.handlePlayerLeave.bind(this);

    // NEW COMMAND HANDLERS
    this.handleBrickSetupCommand = this.handleBrickSetupCommand.bind(this);
    this.handleBrickInteractionCommand = this.handleBrickInteractionCommand.bind(this); 
  }

  async init() {
    console.log('OmeggaBucks: Initializing currency plugin...');

    const loadedBalances = await this.store.get('player_balances');
    this.balances = (loadedBalances && typeof loadedBalances === 'object') ? loadedBalances : {};
    
    // NEW: Load interactive bricks
    const loadedInteractiveBricks = await this.store.get('interactive_bricks');
    this.interactiveBricks = (loadedInteractiveBricks && typeof loadedInteractiveBricks === 'object') ? loadedInteractiveBricks : {};

    console.log(`OmeggaBucks: Loaded ${Object.keys(this.balances).length} player balances.`);
    console.log(`OmeggaBucks: Loaded ${Object.keys(this.interactiveBricks).length} interactive bricks.`);

    // --- Register Commands ---
    this.omegga.on('chatcmd:bucks', this.handleBucksCommand);
    this.omegga.on('chatcmd:balance', this.handleBalanceCommand);
    this.omegga.on('chatcmd:pay', this.handlePayCommand);
    this.omegga.on('chatcmd:request', this.handleRequestCommand);
    this.omegga.on('chatcmd:help', this.handleHelpCommand);
    this.omegga.on('chatcmd:id', this.handleIdCommand);

    // NEW: Register new commands
    this.omegga.on('chatcmd:bucks:setupbrick', this.handleBrickSetupCommand); // Admin command to create interactive bricks
    this.omegga.on('chatcmd:interact', this.handleBrickInteractionCommand); // Generic command for player interaction

    // --- Handle Player Join/Leave ---
    this.omegga.on('join', this.handlePlayerJoin);
    this.omegga.on('leave', this.handlePlayerLeave);

    console.log('OmeggaBucks: Plugin initialized and commands registered.');
  }

  // --- Utility Functions ---

  async getBalance(playerIdentifier) {
    const player = await this.omegga.getPlayer(playerIdentifier);
    if (!player) return null;
    const balance = this.balances[player.id] || 0;
    return balance;
  }

  async setBalance(playerIdentifier, amount) {
    if (typeof amount !== 'number' || amount < 0) {
      console.error(`OmeggaBucks: Invalid amount provided for setBalance: ${amount}`);
      return false;
    }
    const player = await this.omegga.getPlayer(playerIdentifier);
    if (!player) return false;
    this.balances[player.id] = amount;
    await this.store.set('player_balances', this.balances);
    return true;
  }

  async addBalance(playerIdentifier, amount) {
    if (typeof amount !== 'number' || amount <= 0) {
      console.error(`OmeggaBucks: Invalid amount provided for addBalance: ${amount}`);
      return false;
    }
    const currentBalance = await this.getBalance(playerIdentifier);
    if (currentBalance === null) return false;
    return await this.setBalance(playerIdentifier, currentBalance + amount);
  }

  async removeBalance(playerIdentifier, amount) {
    if (typeof amount !== 'number' || amount <= 0) {
      console.error(`OmeggaBucks: Invalid amount provided for removeBalance: ${amount}`);
      return false;
    }
    const currentBalance = await this.getBalance(playerIdentifier);
    if (currentBalance === null) return false;
    const newBalance = Math.max(0, currentBalance - amount);
    return await this.setBalance(playerIdentifier, newBalance);
  }

  // Helper to get a player by name, brickadia ID, or temporary 2-digit ID
  async getPlayerByIdentifier(identifier) {
    let player = await this.omegga.getPlayer(identifier);
    if (player) return player;

    if (identifier.match(/^\d{1,2}$/)) {
        const tempId = String(parseInt(identifier)).padStart(2, '0');
        const playerId = this.tempIdToPlayerId[tempId];
        if (playerId) {
            player = await this.omegga.getPlayer(playerId);
            if (player) return player;
        }
    }
    return null;
  }

  // Helper to assign ID if player doesn't have one
  async assignTempIdIfMissing(player) {
      if (!player || !player.id) {
          console.warn('OmeggaBucks: assignTempIdIfMissing received invalid player object.');
          return;
      }
      if (!this.playerTempIds[player.id]) {
          if (this.availableTempIds.size > 0) {
              const tempId = this.availableTempIds.values().next().value;
              this.availableTempIds.delete(tempId);
              this.playerTempIds[player.id] = tempId;
              this.tempIdToPlayerId[tempId] = player.id;
              this.omegga.whisper(player, `Your temporary in-game ID is: <b><color="FFFFAA">${tempId}</></b>. You can use this with <b>!pay ${tempId} <amount></b>.`);
              console.log(`OmeggaBucks: Assigned temporary ID ${tempId} to ${player.name} (ID: ${player.id}).`);
          } else {
              this.omegga.whisper(player, `<b><color="FF5555">Warning:</></b> No temporary IDs available. You can still use player names for commands.`);
              console.warn(`OmeggaBucks: No temporary IDs available for ${player.name} (ID: ${player.id}).`);
          }
      }
  }

  // NEW: Function to create a unique identifier for a brick using its position
  // This is used for interactive bricks when getLookingAtBrick is not available.
  createBrickKeyFromCoords(x, y, z) {
    // Round to nearest integer for robustness, as coordinates can sometimes be floats
    return `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
  }


  // --- Event Handlers ---

  async handlePlayerJoin(player) {
    if (!player || !player.id) {
        console.warn('OmeggaBucks: handlePlayerJoin received invalid player object.');
        return;
    }

    await this.assignTempIdIfMissing(player);

    if (this.balances[player.id] === undefined) {
      const defaultBalance = this.config.default_starting_balance || 0; 
      await this.setBalance(player.id, defaultBalance);
      this.omegga.whisper(player, `Welcome! You received ${defaultBalance} ${this.config.currency_name || 'Bucks'}s.`);
      console.log(`OmeggaBucks: New player '${player.name}' (ID: ${player.id}) joined and received ${defaultBalance} ${this.config.currency_name || 'Bucks'}s.`);
    }
  }

  async handlePlayerLeave(player) {
    if (!player || !player.id) {
        console.warn('OmeggaBucks: handlePlayerLeave received invalid player object.');
        return;
    }

    const tempId = this.playerTempIds[player.id];
    if (tempId) {
        this.availableTempIds.add(tempId);
        delete this.playerTempIds[player.id];
        delete this.tempIdToPlayerId[tempId];
        console.log(`OmeggaBucks: Player ${player.name} (ID: ${player.id}) left. Temporary ID ${tempId} released.`);
    }
  }

  // --- Command Handlers ---

  async handleBucksCommand(speakerNameStr, subcommand, ...args) {
    const speaker = await this.omegga.getPlayer(speakerNameStr);
    if (!speaker || !speaker.id || !speaker.name) {
      console.warn(`OmeggaBucks: Could not find player object for speaker name "${speakerNameStr}". Ignoring command.`);
      return true;
    }

    await this.assignTempIdIfMissing(speaker);

    const currencyName = this.config.currency_name || 'Bucks';

    if (!subcommand) {
        this.omegga.whisper(speaker, `<b><color="FFD700">OmeggaBucks Admin Commands:</></b>`);
        this.omegga.whisper(speaker, `  <b><color="00FF00">!bucks check [player/id]</></b>: Check your or another player's balance.`);
        this.omegga.whisper(speaker, `  <b><color="00FF00">!bucks add <"player name"/id> <amount> [reason]</></b>: Give money to a player (Admin Only).`);
        this.omegga.whisper(speaker, `  <b><color="00FF00">!bucks remove <"player name"/id> <amount> [reason]</></b>: Take money from a player (Admin Only).`);
        this.omegga.whisper(speaker, `  <b><color="00FF00">!bucks set <"player name"/id> <amount> [reason]</></b>: Set a player's balance (Admin Only).`);
        this.omegga.whisper(speaker, `  <b><color="00FF00">!bucks setupbrick <x> <y> <z> <type> ...</></b>: Create interactive shop/ATM bricks (Admin Only).`);
        this.omegga.whisper(speaker, `  <i><color="CCCCCC">Use quotes for player names with spaces, or their 2-digit ID.</></i>`);
        this.omegga.whisper(speaker, `  For player commands, use <b><color="00FF00">!help</></b>.`);
        return true;
    }

    let targetIdentifier;
    let amount;
    let reason;

    if (subcommand.toLowerCase() === 'check') {
        targetIdentifier = args.join(' ').trim();
    } else if (subcommand.toLowerCase() === 'setupbrick') {
        // This is now handled by handleBrickSetupCommand directly, no need for complex parsing here.
        // The parsing for setupbrick will happen in its dedicated handler.
        return this.handleBrickSetupCommand(speakerNameStr, args[0], args[1], args[2], args[3], ...args.slice(4));
    } else { 
        let amountIndex = -1;
        for (let i = args.length - 1; i >= 0; i--) {
            if (!isNaN(parseFloat(args[i]))) {
                amountIndex = i;
                break;
            }
        }

        if (amountIndex === -1) {
            this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!bucks ${subcommand} <"player name"/id> <amount> [reason]</></b>`);
            this.omegga.whisper(speaker, `  Example: <b><color="00FF00">!bucks ${subcommand} "Player Name" 100 For reason</></b> or <b><color="00FF00">!bucks ${subcommand} 42 50 For reason</></b>`);
            return true;
        }

        amount = parseFloat(args[amountIndex]);
        targetIdentifier = args.slice(0, amountIndex).join(' ').trim();
        reason = args.slice(amountIndex + 1).join(' ').trim();
        if (!reason) reason = 'No reason provided';

        if (!targetIdentifier || isNaN(amount) || (subcommand.toLowerCase() !== 'set' && amount <= 0) || (subcommand.toLowerCase() === 'set' && amount < 0)) {
            this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!bucks ${subcommand} <"player name"/id> <amount> [reason]</></b>`);
            this.omegga.whisper(speaker, `  Example: <b><color="00FF00">!bucks ${subcommand} "Player Name" 100 For reason</></b> or <b><color="00FF00">!bucks ${subcommand} 42 50 For reason</></b>`);
            return true;
        }
    }

    switch (subcommand.toLowerCase()) {
      case 'check':
        {
          let targetPlayer;
          if (targetIdentifier) {
              targetPlayer = await this.getPlayerByIdentifier(targetIdentifier);
          } else {
              targetPlayer = speaker;
          }

          if (!targetPlayer) {
              this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Player "<b><color="FFFFAA">${targetIdentifier}</></b>" or ID "<b><color="FFFFAA">${targetIdentifier}</></b>" not found.`);
              this.omegga.whisper(speaker, `  <i><color="CCCCCC">Remember to use quotes for player names with spaces, or their 2-digit ID.</></i>`);
              return true;
          }

          const balance = await this.getBalance(targetPlayer.id);
          if (balance === null) {
              this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Could not retrieve balance for <b><color="AAAAFF">${targetPlayer.name}</></b>.`);
              console.error(`OmeggaBucks: Could not retrieve balance for ${targetPlayer.name} (${targetPlayer.id})`);
              return true;
          }
          this.omegga.whisper(speaker, `<b><color="AAAAFF">${targetPlayer.name}</></b> has <b><color="FFFFAA">${balance} ${currencyName}s</></b>.`);
          console.log(`OmeggaBucks: ${speaker.name} checked ${targetPlayer.name}'s balance: ${balance} ${currencyName}s.`);
        }
        break;
      case 'add':
      case 'remove':
      case 'set':
        {
          const customAdminName = speaker.name;

          const targetPlayer = await this.getPlayerByIdentifier(targetIdentifier);
          if (!targetPlayer) {
            this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Player "<b><color="FFFFAA">${targetIdentifier}</></b>" or ID "<b><color="FFFFAA">${targetIdentifier}</></b>" not found.`);
            this.omegga.whisper(speaker, `  <i><color="CCCCCC">Remember to use quotes for player names with spaces, or their 2-digit ID.</></i>`);
            return true;
          }

          let success = false;
          let actionMessage = '';
          switch (subcommand.toLowerCase()) {
              case 'add':
                  success = await this.addBalance(targetPlayer.id, amount);
                  actionMessage = `added <b><color="FFFFAA">${amount} ${currencyName}s</></b> to`;
                  break;
              case 'remove':
                  success = await this.removeBalance(targetPlayer.id, amount);
                  actionMessage = `removed <b><color="FFFFAA">${amount} ${currencyName}s</></b> from`;
                  break;
              case 'set':
                  success = await this.setBalance(targetPlayer.id, amount);
                  actionMessage = `set <b><color="AAAAFF">${targetPlayer.name}</>'s</></b> balance to <b><color="FFFFAA">${amount} ${currencyName}s</></b>`;
                  break;
          }
          
          if (success) {
            const newBalance = await this.getBalance(targetPlayer.id);
            if (subcommand.toLowerCase() !== 'set') {
                this.omegga.whisper(speaker, `You ${actionMessage} <b><color="AAAAFF">${targetPlayer.name}</>'s</></b> balance. New balance: <b><color="FFFFAA">${newBalance}</></b>`);
                this.omegga.broadcast(`<b><color="55FF55">${customAdminName}</></b> ${actionMessage} <b><color="AAAAFF">${targetPlayer.name}</>'s</></b> balance. Reason: "<b><color="FFFF55">${reason}</></b>"`);
            } else {
                 this.omegga.whisper(speaker, `You ${actionMessage}. New balance: <b><color="FFFFAA">${newBalance}</></b>`);
                 this.omegga.broadcast(`<b><color="55FFFF">${customAdminName}</></b> ${actionMessage}. Reason: "<b><color="FFFF55">${reason}</></b>"`);
            }
            console.log(`OmeggaBucks: ${customAdminName} ${subcommand} ${amount} ${currencyName}s for ${targetPlayer.name} (ID: ${targetPlayer.id}). Reason: "${reason}"`);
          } else {
            this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Failed to ${subcommand} <b><color="FFFFAA">${amount} ${currencyName}s</></b> for <b><color="AAAAFF">${targetPlayer.name}</></b>.`);
          }
        }
        break;
      default:
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Unknown <b><color="00FF00">!bucks</></b> subcommand: "<b><color="FFFFAA">${subcommand}</></b>".`);
        this.omegga.whisper(speaker, `  Use <b><color="00FF00">!bucks</></b> for a list of subcommands.`);
    }
    return true;
  }

  async handleBalanceCommand(speakerNameStr) {
    const speaker = await this.omegga.getPlayer(speakerNameStr);
    if (!speaker || !speaker.id || !speaker.name) {
      console.warn(`OmeggaBucks: Could not find player object for speaker name "${speakerNameStr}". Ignoring command.`);
      return true;
    }

    await this.assignTempIdIfMissing(speaker);

    const currencyName = this.config.currency_name || 'Bucks';
    
    const balance = await this.getBalance(speaker.id);
    if (balance === null) {
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Could not retrieve your balance.`);
        console.error(`OmeggaBucks: Could not retrieve balance for speaker ${speaker.name} (${speaker.id})`);
        return true;
    }
    this.omegga.whisper(speaker, `You have <b><color="FFFFAA">${balance} ${currencyName}s</></b>.`);
    console.log(`OmeggaBucks: ${speaker.name} checked their balance: ${balance} ${currencyName}s.`);
    return true;
  }

  async handlePayCommand(speakerNameStr, ...args) { 
    const speaker = await this.omegga.getPlayer(speakerNameStr);
    if (!speaker || !speaker.id || !speaker.name) {
      console.warn(`OmeggaBucks: Could not find player object for speaker name "${speakerNameStr}". Ignoring command.`);
      return true;
    }

    await this.assignTempIdIfMissing(speaker);

    const currencyName = this.config.currency_name || 'Bucks';
    
    let targetIdentifier;
    let amount;
    let reason;

    let amountIndex = -1;
    for (let i = args.length - 1; i >= 0; i--) {
        if (!isNaN(parseFloat(args[i]))) {
            amountIndex = i;
            break;
        }
    }

    if (amountIndex === -1) {
        this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!pay <"player name"/id> <amount> [reason]</></b>`);
        this.omegga.whisper(speaker, `  Example: <b><color="00FF00">!pay "Target Player" 50 For a job well done</></b> or <b><color="00FF00">!pay 42 25 For stuff</></b>`);
        this.omegga.whisper(speaker, `  <i><color="CCCCCC">Use quotes for player names with spaces, or their 2-digit ID.</></i>`);
        return true;
    }

    amount = parseFloat(args[amountIndex]);
    targetIdentifier = args.slice(0, amountIndex).join(' ').trim();
    reason = args.slice(amountIndex + 1).join(' ').trim();
    if (!reason) reason = 'No reason provided';

    if (!targetIdentifier || isNaN(amount) || amount <= 0) {
      this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!pay <"player name"/id> <amount> [reason]</></b>`);
      this.omegga.whisper(speaker, `  Example: <b><color="00FF00">!pay "Target Player" 50 For a job well done</></b> or <b><color="00FF00">!pay 42 25 For stuff</></b>`);
      this.omegga.whisper(speaker, `  <i><color="CCCCCC">Use quotes for player names with spaces, or their 2-digit ID.</></i>`);
      return true;
    }

    const senderBalance = await this.getBalance(speaker.id);
    if (senderBalance === null) {
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Could not retrieve your balance.`);
        return true;
    }

    if (senderBalance < amount) {
      this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> You do not have enough <b><color="FFFFAA">${currencyName}s</></b> to send <b><color="FFFFAA">${amount}</></b>.`);
      this.omegga.whisper(speaker, `  You currently have <b><color="FFFFAA">${senderBalance} ${currencyName}s</></b>.`);
      return true;
    }

    const targetPlayer = await this.getPlayerByIdentifier(targetIdentifier);
    if (!targetPlayer) {
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Player "<b><color="FFFFAA">${targetIdentifier}</></b>" or ID "<b><color="FFFFAA">${targetIdentifier}</></b>" not found.`);
        this.omegga.whisper(speaker, `  <i><color="CCCCCC">Remember to use quotes for player names with spaces, or their 2-digit ID.</></i>`);
        return true;
    }

    if (targetPlayer.id === speaker.id) {
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> You cannot pay yourself.`);
        return true;
    }

    const removeSuccess = await this.removeBalance(speaker.id, amount);
    const addSuccess = await this.addBalance(targetPlayer.id, amount);

    if (removeSuccess && addSuccess) {
      this.omegga.whisper(speaker, `You sent <b><color="FFFFAA">${amount} ${currencyName}s</></b> to <b><color="AAAAFF">${targetPlayer.name}</></b>. Your new balance: <b><color="FFFFAA">${await this.getBalance(speaker.id)}</></b>.`);
      this.omegga.whisper(targetPlayer, `<b><color="AAAAFF">${speaker.name}</></b> sent you <b><color="FFFFAA">${amount} ${currencyName}s</></b>. Your new balance: <b><color="FFFFAA">${await this.getBalance(targetPlayer.id)}</></b>.`);
      this.omegga.broadcast(`<b><color="AAAAFF">${speaker.name}</></b> paid <b><color="AAAAFF">${targetPlayer.name}</></b> <b><color="FFFFAA">${amount} ${currencyName}s</></b>. Reason: "<b><color="FFFF55">${reason}</></b>"`);
      console.log(`OmeggaBucks: ${speaker.name} paid ${targetPlayer.name} ${amount} ${currencyName}s. Reason: "${reason}"`);
    } else {
      this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Failed to complete payment to <b><color="AAAAFF">${targetPlayer.name}</></b>.`);
      if (removeSuccess && !addSuccess) {
        await this.addBalance(speaker.id, amount);
        console.error(`OmeggaBucks: Payment failed for ${targetPlayer.name}, reverted sender's balance.`);
      } else if (!removeSuccess && addSuccess) {
         await this.removeBalance(targetPlayer.id, amount);
         console.error(`OmeggaBucks: Payment failed for ${speaker.name}, reverted receiver's balance.`);
      }
    }
    return true;
  }

  async handleRequestCommand(speakerNameStr, ...args) { 
    const speaker = await this.omegga.getPlayer(speakerNameStr);
    if (!speaker || !speaker.id || !speaker.name) {
      console.warn(`OmeggaBucks: Could not find player object for speaker name "${speakerNameStr}". Ignoring command.`);
      return true;
    }

    await this.assignTempIdIfMissing(speaker);

    const currencyName = this.config.currency_name || 'Bucks';
    
    let targetIdentifier;
    let amount;
    let reason;

    let amountIndex = -1;
    for (let i = args.length - 1; i >= 0; i--) {
        if (!isNaN(parseFloat(args[i]))) {
            amountIndex = i;
            break;
        }
    }

    if (amountIndex === -1) {
        this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!request <"player name"/id> <amount> [reason]</></b>`);
        this.omegga.whisper(speaker, `  Example: <b><color="00FF00">!request "Other Player" 25 For building materials</></b> or <b><color="00FF00">!request 05 10 For a brick</></b>`);
        return true;
    }

    amount = parseFloat(args[amountIndex]);
    targetIdentifier = args.slice(0, amountIndex).join(' ').trim();
    reason = args.slice(amountIndex + 1).join(' ').trim();
    if (!reason) reason = 'No reason provided';

    if (!targetIdentifier || isNaN(amount) || amount <= 0) {
      this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!request <"player name"/id> <amount> [reason]</></b>`);
      this.omegga.whisper(speaker, `  Example: <b><color="00FF00">!request "Other Player" 25 For building materials</></b> or <b><color="00FF00">!request 05 10 For a brick</></b>`);
      this.omegga.whisper(speaker, `  <i><color="CCCCCC">Use quotes for player names with spaces, or their 2-digit ID.</></i>`);
      return true;
    }

    const targetPlayer = await this.getPlayerByIdentifier(targetIdentifier);
    if (!targetPlayer) {
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Player "<b><color="FFFFAA">${targetIdentifier}</></b>" or ID "<b><color="FFFFAA">${targetIdentifier}</></b>" not found.`);
        this.omegga.whisper(speaker, `  <i><color="CCCCCC">Remember to use quotes for player names with spaces, or their 2-digit ID.</></i>`);
        return true;
    }

    if (targetPlayer.id === speaker.id) {
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> You cannot request from yourself.`);
        return true;
    }

    this.omegga.whisper(speaker, `You requested <b><color="FFFFAA">${amount} ${currencyName}s</></b> from <b><color="AAAAFF">${targetPlayer.name}</></b>.`);
    this.omegga.whisper(targetPlayer, `<b><color="AAAAFF">${speaker.name}</></b> is requesting <b><color="FFFFAA">${amount} ${currencyName}s</></b> from you. Reason: "<b><color="FFFF55">${reason}</></b>"`);
    const speakerTempId = this.playerTempIds[speaker.id];
    let payCommandHint = `To send the money, use: <b><color="00FF00">!pay "${speaker.name}" ${amount} ${reason}</></b>`;
    if (speakerTempId) {
        payCommandHint += ` or <b><color="00FF00">!pay ${speakerTempId} ${amount} ${reason}</></b>`;
    }
    this.omegga.whisper(targetPlayer, payCommandHint);
    console.log(`OmeggaBucks: ${speaker.name} requested ${amount} ${currencyName}s from ${targetPlayer.name}. Reason: "${reason}"`);
    return true;
  }

  async handleHelpCommand(speakerNameStr) {
    const speaker = await this.omegga.getPlayer(speakerNameStr);
    if (!speaker || !speaker.id || !speaker.name) {
      console.warn(`OmeggaBucks: Could not find player object for speaker name "${speakerNameStr}". Ignoring command.`);
      return true;
    }

    await this.assignTempIdIfMissing(speaker);

    this.omegga.whisper(speaker, `<b><color="FFD700">OmeggaBucks Player Commands:</></b>`);
    this.omegga.whisper(speaker, `  <b><color="00FF00">!balance</></b>: Check your current balance.`);
    this.omegga.whisper(speaker, `  <b><color="00FF00">!id</></b>: Show your temporary in-game ID.`);
    this.omegga.whisper(speaker, `  <b><color="00FF00">!pay <"player name"/id> <amount> [reason]</></b>: Send money to another player.`);
    this.omegga.whisper(speaker, `  <b><color="00FF00">!request <"player name"/id> <amount> [reason]</></b>: Request money from another player.`);
    this.omegga.whisper(speaker, `  <i><color="CCCCCC">Use quotes for player names with spaces, or their 2-digit ID.</></i>`);
    this.omegga.whisper(speaker, `  For admin commands, type <b><color="00FF00">!bucks</></b>.`);
    return true;
  }

  async handleIdCommand(speakerNameStr) {
    const speaker = await this.omegga.getPlayer(speakerNameStr);
    if (!speaker || !speaker.id || !speaker.name) {
      console.warn(`OmeggaBucks: Could not find player object for speaker name "${speakerNameStr}". Ignoring command.`);
      return true;
    }

    await this.assignTempIdIfMissing(speaker);

    const tempId = this.playerTempIds[speaker.id];
    if (tempId) {
        this.omegga.whisper(speaker, `Your temporary in-game ID is: <b><color="FFFFAA">${tempId}</></b>.`);
        this.omegga.whisper(speaker, `You can use this with commands like <b><color="00FF00">!pay ${tempId} <amount></></b>.`);
    } else {
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Could not assign a temporary ID at this time. All IDs may be in use.`);
    }
    return true;
  }

  // NEW: Admin command to set up an interactive brick using coordinates
  // Usage: !bucks setupbrick <x> <y> <z> <type> [item_id] [price/amount]
  async handleBrickSetupCommand(speakerNameStr, xStr, yStr, zStr, type, ...args) {
    const speaker = await this.omegga.getPlayer(speakerNameStr);
    if (!speaker || !speaker.id || !speaker.name) return true;

    // TODO: Add proper permission check for admin roles (e.g., if (!speaker.isHost && !speaker.isModerator))
    if (!speaker.isHost) { // Only host can set up initially
      this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> You do not have permission to set up interactive bricks.`);
      return true;
    }

    const x = parseInt(xStr);
    const y = parseInt(yStr);
    const z = parseInt(zStr);

    if (isNaN(x) || isNaN(y) || isNaN(z)) {
        this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!bucks setupbrick <x> <y> <z> <type> [item_id] [price/amount]</></b>`);
        this.omegga.whisper(speaker, `  Example: <b><color="00FF00">!bucks setupbrick 0 0 0 shop sword 100</></b> or <b><color="00FF00">!bucks setupbrick 50 20 10 atm-give 50</></b>`);
        this.omegga.whisper(speaker, `  <i><color="CCCCCC">Use the coordinates of the center of the brick you want to make interactive.</></i>`);
        return true;
    }

    const brickKey = this.createBrickKeyFromCoords(x, y, z);
    const currencyName = this.config.currency_name || 'Bucks';
    let message = '';
    let storedData = null;

    switch (type.toLowerCase()) {
      case 'shop': // !bucks setupbrick <x> <y> <z> shop <item_id> <price>
        {
          const itemId = args[0];
          const price = parseFloat(args[1]);
          if (!itemId || isNaN(price) || price <= 0) {
            this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!bucks setupbrick ${x} ${y} ${z} shop &lt;item_id&gt; &lt;price&gt;</></b>`);
            return true;
          }
          storedData = { type: 'shop', itemId: itemId, price: price, brickOwnerId: speaker.id }; // Store admin's ID as brick owner
          message = `Set up a shop brick at (${x}, ${y}, ${z}) selling <b><color="FFFFAA">${itemId}</></b> for <b><color="FFFFAA">${price} ${currencyName}s</></b>.`;
        }
        break;
      case 'atm-give': // !bucks setupbrick <x> <y> <z> atm-give <amount>
        {
          const amount = parseFloat(args[0]);
          if (isNaN(amount) || amount <= 0) {
            this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!bucks setupbrick ${x} ${y} ${z} atm-give &lt;amount&gt;</></b>`);
            return true;
          }
          storedData = { type: 'atm-give', amount: amount, brickOwnerId: speaker.id };
          message = `Set up an ATM brick at (${x}, ${y}, ${z}) giving <b><color="FFFFAA">${amount} ${currencyName}s</></b>.`;
        }
        break;
      case 'atm-take': // !bucks setupbrick <x> <y> <z> atm-take <amount>
        {
          const amount = parseFloat(args[0]);
          if (isNaN(amount) || amount <= 0) {
            this.omegga.whisper(speaker, `<b><color="FFD700">Usage:</></b> <b><color="00FF00">!bucks setupbrick ${x} ${y} ${z} atm-take &lt;amount&gt;</></b>`);
            return true;
          }
          storedData = { type: 'atm-take', amount: amount, brickOwnerId: speaker.id };
          message = `Set up an ATM brick at (${x}, ${y}, ${z}) taking <b><color="FFFFAA">${amount} ${currencyName}s</></b>.`;
        }
        break;
      case 'remove': // !bucks setupbrick <x> <y> <z> remove
        {
          if (this.interactiveBricks[brickKey]) {
            delete this.interactiveBricks[brickKey];
            message = `Removed interactive functionality from brick at (${x}, ${y}, ${z}).`;
            await this.store.set('interactive_bricks', this.interactiveBricks);
            this.omegga.whisper(speaker, `<b><color="00FF00">Success:</></b> ${message}`);
            console.log(`OmeggaBucks: ${speaker.name} removed interactive brick at ${brickKey}`);
            return true;
          } else {
            this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> No interactive currency brick found at (${x}, ${y}, ${z}).`);
            return true;
          }
        }
      default:
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Unknown setup type "<b><color="FFFFAA">${type}</></b>".`);
        this.omegga.whisper(speaker, `  Available types: <b><color="00FF00">shop, atm-give, atm-take, remove</></b>.`);
        return true;
    }

    this.interactiveBricks[brickKey] = storedData;
    await this.store.set('interactive_bricks', this.interactiveBricks);
    this.omegga.whisper(speaker, `<b><color="00FF00">Success:</></b> ${message}`);
    this.omegga.whisper(speaker, `  Remember to add a <b>Touch Component</b> to the brick at (${x}, ${y}, ${z}):`);
    this.omegga.whisper(speaker, `  <b>On Touched</b> -> <b>Execute Command</b> -> <b><color="00FF00">!interact</></b>`);
    console.log(`OmeggaBucks: ${speaker.name} set up interactive brick at ${brickKey}: ${JSON.stringify(storedData)}`);
    return true;
  }

  // NEW: Player command to interact with a brick
  async handleBrickInteractionCommand(speakerNameStr) {
    const speaker = await this.omegga.getPlayer(speakerNameStr);
    if (!speaker || !speaker.id || !speaker.name) return true;

    const playerPos = await this.omegga.getPlayerWorldPos(speaker.id);
    if (!playerPos) {
      this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Could not determine your position.`);
      return true;
    }

    const currencyName = this.config.currency_name || 'Bucks';
    let foundInteractiveBrick = null;
    let foundBrickKey = null;

    // Iterate through all known interactive bricks and check proximity
    for (const brickKey in this.interactiveBricks) {
      // Split the key and parse coordinates
      const parts = brickKey.split(',');
      if (parts.length < 3) continue; // Skip invalid keys
      const [x, y, z] = parts.slice(0, 3).map(Number);
      
      // A small buffer around the brick (e.g., 2 units)
      const proximityThreshold = 3; // Adjust as needed for player reach

      const distSq = (playerPos[0] - x)**2 +
                     (playerPos[1] - y)**2 +
                     (playerPos[2] - z)**2;
      
      // If player is close enough, consider this the brick they touched
      // This is a heuristic since Omegga's chat commands don't pass brick info
      if (distSq <= proximityThreshold**2) {
        foundInteractiveBrick = this.interactiveBricks[brickKey];
        foundBrickKey = brickKey;
        break; 
      }
    }

    if (!foundInteractiveBrick) {
      this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> You are not near an interactive currency brick.`);
      return true;
    }

    // Now, execute the action based on the found brick's type
    let success = false;
    const { type, itemId, price, amount, brickOwnerId } = foundInteractiveBrick;

    switch (type) {
      case 'shop':
        const cost = price;
        const currentBalance = await this.getBalance(speaker.id);
        if (currentBalance === null) { 
             this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Could not retrieve your balance.`);
             return true;
        }
        if (currentBalance < cost) {
          this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> You need <b><color="FFFFAA">${cost} ${currencyName}s</></b> to buy <b><color="FFFFAA">${itemId}</></b>. You have <b><color="FFFFAA">${currentBalance} ${currencyName}s</></b>.`);
          return true;
        }
        
        success = await this.removeBalance(speaker.id, cost);
        if (success) {
            // TODO: Implement actual item giving here!
            // For now, it's just a message.
            this.omegga.whisper(speaker, `<b><color="00FF00">Success:</></b> You bought <b><color="FFFFAA">${itemId}</></b> for <b><color="FFFFAA">${cost} ${currencyName}s</></b>. Your new balance: <b><color="FFFFAA">${await this.getBalance(speaker.id)}</></b>.`);
            this.omegga.broadcast(`<b><color="AAAAFF">${speaker.name}</></b> bought <b><color="FFFFAA">${itemId}</></b> from a shop brick.`);
            console.log(`OmeggaBucks: ${speaker.name} bought ${itemId} for ${cost} from brick ${foundBrickKey}.`);

            // Optionally, add money to the brick owner if they are a player
            if (brickOwnerId) {
                const brickOwnerPlayer = await this.omegga.getPlayer(brickOwnerId);
                // Don't pay if player buys from their own brick AND they are the actual owner
                // Check if brickOwnerPlayer exists and if the brick's owner ID is different from the buyer's ID
                if (brickOwnerPlayer && brickOwnerId !== speaker.id) { 
                    await this.addBalance(brickOwnerId, cost);
                    this.omegga.whisper(brickOwnerPlayer, `Your shop brick sold <b><color="FFFFAA">${itemId}</></b> to <b><color="AAAAFF">${speaker.name}</></b> for <b><color="FFFFAA">${cost} ${currencyName}s</></b>. New balance: <b><color="FFFFAA">${await this.getBalance(brickOwnerId)}</></b>.`);
                }
            }
        }
        break;
      case 'atm-give':
        success = await this.addBalance(speaker.id, amount);
        if (success) {
          this.omegga.whisper(speaker, `<b><color="00FF00">Success:</></b> You received <b><color="FFFFAA">${amount} ${currencyName}s</></b> from the ATM. Your new balance: <b><color="FFFFAA">${await this.getBalance(speaker.id)}</></b>.`);
          this.omegga.broadcast(`<b><color="AAAAFF">${speaker.name}</></b> used an ATM to get <b><color="FFFFAA">${amount} ${currencyName}s</></b>.`);
          console.log(`OmeggaBucks: ${speaker.name} got ${amount} from ATM brick ${foundBrickKey}.`);
        }
        break;
      case 'atm-take':
        const takeAmount = amount;
        const currentBalanceTake = await this.getBalance(speaker.id);
        if (currentBalanceTake === null) { 
             this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Could not retrieve your balance.`);
             return true;
        }
        if (currentBalanceTake < takeAmount) {
          this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> You need <b><color="FFFFAA">${takeAmount} ${currencyName}s</></b> to use this ATM. You only have <b><color="FFFFAA">${currentBalanceTake} ${currencyName}s</></b>.`);
          return true;
        }
        success = await this.removeBalance(speaker.id, takeAmount);
        if (success) {
          this.omegga.whisper(speaker, `<b><color="00FF00">Success:</></b> You paid <b><color="FFFFAA">${takeAmount} ${currencyName}s</></b> to the ATM. Your new balance: <b><color="FFFFAA">${await this.getBalance(speaker.id)}</></b>.`);
          this.omegga.broadcast(`<b><color="AAAAFF">${speaker.name}</></b> used an ATM to deposit <b><color="FFFFAA">${takeAmount} ${currencyName}s</></b>.`);
          console.log(`OmeggaBucks: ${speaker.name} paid ${takeAmount} to ATM brick ${foundBrickKey}.`);
        }
        break;
      default:
        this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> This interactive brick has an unknown configuration.`);
        return true;
    }

    if (!success) { // Catch-all for transactions that failed despite passing initial checks
      this.omegga.whisper(speaker, `<b><color="FF5555">Error:</></b> Transaction failed. Please try again.`);
    }
    return true;
  }

  async stop() {
    console.log('OmeggaBucks: Stopping currency plugin...');
    this.omegga.off('chatcmd:bucks', this.handleBucksCommand);
    this.omegga.off('chatcmd:balance', this.handleBalanceCommand);
    this.omegga.off('chatcmd:pay', this.handlePayCommand);
    this.omegga.off('chatcmd:request', this.handleRequestCommand);
    this.omegga.off('chatcmd:help', this.handleHelpCommand);
    this.omegga.off('chatcmd:id', this.handleIdCommand);
    
    // NEW: Deregister new commands
    this.omegga.off('chatcmd:bucks:setupbrick', this.handleBrickSetupCommand);
    this.omegga.off('chatcmd:interact', this.handleBrickInteractionCommand);

    this.omegga.off('join', this.handlePlayerJoin);
    this.omegga.off('leave', this.handlePlayerLeave);
  }
};
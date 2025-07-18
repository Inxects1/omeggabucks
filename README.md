# 💰 OmeggaBucks - Persistent Currency System for Omegga

OmeggaBucks is a powerful and easy-to-use plugin for your Omegga server that introduces a persistent in-game currency system. Players can earn, check, pay, and request currency from each other, while admins have comprehensive control over balances.

---

## ✨ Features

* **Persistent Balances:** All player currency balances are automatically saved and loaded across server restarts, ensuring a stable economy.
* **Player-to-Player Transactions:** Players can easily send (`!pay`) and request (`!request`) currency from each other, fostering player interaction and trade.
* **Temporary In-Game IDs:** Simplifies transactions by assigning short, unique 2-digit IDs to online players, usable in commands instead of full names or Brickadia IDs.
* **Comprehensive Admin Controls:** Server administrators have full power to `add`, `remove`, or `set` any player's currency balance.
* **Configurable Currency Name:** Easily change the name of your currency (e.g., "Coins", "Credits", "Gems") through the plugin's configuration.

---

## 🚀 Installation

Omegga makes plugin installation incredibly easy!

### Option 1: Install via Omegga CLI (Offline)

1.  **Open your server's terminal/console.**
2.  **Run the install command:**
    ```bash
    omegga install gh:Inxects1/omeggabucks
    ```
    This command tells Omegga to download and set up the plugin directly from its GitHub repository.
3.  **Restart your Omegga server.**

### Option 2: Install via Server Command (Online)

1.  **Attach your Omegga server.**
2.  **Type the install command in terminal:**
    ```
    /plugins install gh:Inxects1/omeggabucks
    ```
    The server will download and enable the plugin. You may need to restart the server for all features to take full effect, especially after a fresh install.

## 🎮 In-Game Commands

All commands are prefixed with `!`.

### Player Commands

* **`!balance`**
    * **Description:** Checks your current currency balance.
    * **Example:** `!balance`
* **`!pay <"player name"/id> <amount> [reason]`**
    * **Description:** Sends currency to another player. You can use their full name (in quotes if it has spaces) or their temporary 2-digit ID.
    * **Examples:**
        * `!pay "Builder Bob" 50 For a job well done`
        * `!pay 42 25 For some bricks` (if player's temporary ID is 42)
* **`!request <"player name"/id> <amount> [reason]`**
    * **Description:** Requests currency from another player.
    * **Examples:**
        * `!request "Other Player" 25 For building materials`
        * `!request 05 10 For a tool`
* **`!id`**
    * **Description:** Displays your temporary in-game ID, which can be used with `!pay` and `!request`.
    * **Example:** `!id`
* **`!help`**
    * **Description:** Displays a list of player commands.
    * **Example:** `!help`

### Admin Commands (`!bucks` subcommand)

These commands require host/admin privileges. Type `!bucks` for an in-game list of these subcommands.

* **`!bucks check [player/id]`**
    * **Description:** Checks your or another player's balance. If no player is specified, it checks your own.
    * **Examples:**
        * `!bucks check`
        * `!bucks check "Player Name"`
        * `!bucks check 42`
* **`!bucks add <"player name"/id> <amount> [reason]`**
    * **Description:** Gives currency to a player.
    * **Example:** `!bucks add "New Player" 100 Welcome bonus`
* **`!bucks remove <"player name"/id> <amount> [reason]`**
    * **Description:** Takes currency from a player.
    * **Example:** `!bucks remove "Trouble Maker" 50 For griefing`
* **`!bucks set <"player name"/id> <amount> [reason]`**
    * **Description:** Sets a player's balance to a specific amount.
    * **Example:** `!bucks set "Server Owner" 10000 Initial funds`

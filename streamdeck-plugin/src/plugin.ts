import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { SelectSlotAction } from "./actions/select-slot.js";

// Set log level based on environment
streamDeck.logger.setLevel(LogLevel.TRACE);

// Register the select-slot action
streamDeck.actions.registerAction(new SelectSlotAction());

// Connect to the Stream Deck software
streamDeck.connect();

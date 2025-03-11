import { Request, Response } from "express";
import asyncHandler from "../utils/asyncHandler";
import Lead from "../models/Lead";
import ChatHistory from "../models/ChatHistory";
import { extractPersonData } from "../utils/gemini";
import axios from "axios";

// Function to send template message to new leads
const sendWelcomeTemplate = async (
  leadPhoneNumber: string,
  businessPhoneId: string
) => {
  try {
    const response = await axios({
      method: "post",
      url: `https://graph.facebook.com/v22.0/${businessPhoneId}/messages`,
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: {
        messaging_product: "whatsapp",
        to: leadPhoneNumber,
        type: "template",
        template: {
          name: "order_confirmation_4",
          language: {
            code: "en_US",
          },
        },
      },
    });

    console.log("Template message sent successfully:", response.data);
    return response.data;
  } catch (error) {
    console.error("Error sending template message:", error);
    throw error;
  }
};

export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
};

export const processWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      console.log("Request received");
      const body = req.body;
      console.log("Webhook request body:", body);

      // Check if this is an event from a WhatsApp Business Account
      if (body.object === "whatsapp_business_account") {
        // Get relevant data from the webhook payload
        for (const entry of body.entry) {
          for (const change of entry.changes) {
            if (change.field === "messages") {
              const metadata = change.value.metadata;
              const businessPhoneNumber = metadata.display_phone_number;
              const businessPhoneId = metadata.phone_number_id;

              // Process each message in the entry
              for (const message of change.value.messages || []) {
                // Extract lead phone number and message body
                const leadPhoneNumber = message.from;
                const messageBody =
                  message.text?.body || extractMediaContent(message);
                const messageId = message.id;
                const timestamp = new Date(parseInt(message.timestamp) * 1000);

                console.log("lead", leadPhoneNumber, messageBody);

                const { lead, isNewLead } = await updateLeadWithChatMessage(
                  leadPhoneNumber,
                  businessPhoneNumber,
                  businessPhoneId,
                  {
                    messageId,
                    content: messageBody,
                    role: "lead",
                    timestamp,
                  }
                );

                // Skip extractPersonData for new leads
                if (!isNewLead) {
                  // For existing leads, create a conversation string from chat history
                  const conversationString = createConversationString(
                    lead.chatHistory,
                    messageBody
                  );
                  console.log(
                    "Conversation string for extractPersonData:",
                    conversationString
                  );

                  // Use extractPersonData with the full conversation context
                  const extractedData =
                    await extractPersonData(conversationString);

                  console.log("extractedData", extractedData);
                  if (extractedData && typeof extractedData === "object") {
                    const updateFields: any = {};

                    // Only update fields that aren't already present in the lead
                    if (extractedData.preferredCountry) {
                      updateFields.preferredCountry =
                        extractedData.preferredCountry;
                    }

                    if (extractedData.city) {
                      updateFields.city = extractedData.city;
                    }

                    if (extractedData.state) {
                      updateFields.state = extractedData.state;
                    }

                    if (extractedData.neetScore) {
                      updateFields.neetScore = extractedData.neetScore;
                    }

                    if (extractedData.name && !lead.name) {
                      updateFields.name = extractedData.name;
                    }

                    if (extractedData.numberOfEnquiry) {
                      // For numberOfEnquiry, increment if it exists
                      updateFields.numberOfEnquiry =
                        (lead.numberOfEnquiry || 0) + 1;
                    }

                    console.log("updateFields", updateFields);
                    // If we have fields to update, apply the update
                    if (Object.keys(updateFields).length > 0) {
                      await Lead.updateOne(
                        { _id: lead._id },
                        { $set: updateFields }
                      );
                      console.log(
                        `Updated lead with extracted data for ${lead.leadPhoneNumber}:`,
                        updateFields
                      );
                    }
                  }
                }

                console.log(
                  `Processed message from ${leadPhoneNumber}: ${messageBody}`
                );
              }
            }

            // Process status updates if needed
            if (change.field === "messages" && change.value.statuses) {
              for (const status of change.value.statuses) {
                console.log(
                  `Message status update: ${status.status} for message ${status.id}`
                );
                // Update message status in the lead document if needed
                await updateMessageStatus(status.id, status.status);
              }
            }
          }
        }

        // Return a '200 OK' response to acknowledge receipt of the event
        res.status(200).send("EVENT_RECEIVED");
      } else {
        // Return a '404 Not Found' if event is not from WhatsApp Business Account
        res.sendStatus(404);
      }
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).send("ERROR_PROCESSING");
    }
  }
);

/**
 * Extract content from media messages
 */
const extractMediaContent = (message: any): string => {
  if (message.image) {
    return "[Image message]";
  } else if (message.audio) {
    return "[Audio message]";
  } else if (message.video) {
    return "[Video message]";
  } else if (message.document) {
    return "[Document message]";
  } else if (message.location) {
    return `[Location: Lat ${message.location.latitude}, Long ${message.location.longitude}]`;
  } else if (message.contacts) {
    return "[Contact information]";
  } else if (message.sticker) {
    return "[Sticker]";
  } else if (message.reaction) {
    return `[Reaction: ${message.reaction.emoji}]`;
  } else {
    return "[Unknown message type]";
  }
};

/**
 * Update lead with new chat message and send welcome template if it's a new lead
 */
const updateLeadWithChatMessage = async (
  leadPhoneNumber: string,
  businessPhoneNumber: string,
  businessPhoneId: string,
  message: {
    messageId: string;
    content: string;
    role: "lead" | "assistant";
    timestamp: Date;
  }
) => {
  try {
    // Check if lead exists
    let lead = await Lead.findOne({
      leadPhoneNumber,
      businessPhoneNumber,
    });

    let isNewLead = false;

    if (!lead) {
      isNewLead = true;
      // Create new lead if not exists
      lead = await Lead.create({
        leadPhoneNumber,
        businessPhoneNumber,
        businessPhoneId,
        firstInteraction: message.timestamp,
        lastInteraction: message.timestamp,
        messageCount: 1,
        numberOfChatsMessages: 1,
        numberOfEnquiry: 1,
        status: "active",
        chatHistory: [message],
      });
      console.log(`New lead created: ${leadPhoneNumber}`);

      // Send welcome template message to new lead
      try {
        console.log(`Sending welcome template to new lead: ${leadPhoneNumber}`);
        const templateResponse = await sendWelcomeTemplate(
          leadPhoneNumber,
          businessPhoneId
        );

        // Add template message to chat history
        const templateMessage = {
          messageId:
            templateResponse.messages?.[0]?.id || `template_${Date.now()}`,
          content: "[Order confirmation template message]",
          role: "assistant" as "assistant" | "lead",
          timestamp: new Date(),
          status: "sent" as "sent" | "delivered" | "read" | "failed",
        };

        lead.chatHistory.push(templateMessage);
        lead.messageCount = 2; // Initial message + template message
        await lead.save();

        console.log(
          `Template message added to chat history for new lead ${leadPhoneNumber}`
        );
      } catch (templateError) {
        console.error(
          `Failed to send template message to ${leadPhoneNumber}:`,
          templateError
        );
      }
    } else {
      // Update existing lead
      lead.lastInteraction = message.timestamp;
      lead.messageCount = (lead.messageCount || 0) + 1;
      lead.numberOfChatsMessages = (lead.numberOfChatsMessages || 0) + 1;
      lead.status = "active";

      // Add message to chat history
      lead.chatHistory.push(message);

      await lead.save();
      console.log(`Lead updated: ${leadPhoneNumber}`);
    }

    return { lead, isNewLead };
  } catch (error) {
    console.error("Error updating lead with chat message:", error);
    throw error;
  }
};

/**
 * Create a formatted conversation string from chat history
 */
const createConversationString = (
  chatHistory: Array<any>,
  currentMessage: string
): string => {
  // Only use the most recent messages (last 10) to keep the context manageable
  const recentMessages = chatHistory.slice(-10);

  // Format the conversation as a string with role labels
  let conversationString = recentMessages
    .map((msg) => {
      const role = msg.role === "lead" ? "lead" : "assistant";
      return `${role}: "${msg.content}"`;
    })
    .join("\n");

  // Add the current message (which might not be in the chat history yet)
  conversationString += `\nlead: "${currentMessage}"`;

  return conversationString;
};

/**
 * Update message status in the lead document
 */
const updateMessageStatus = async (messageId: string, status: string) => {
  try {
    const lead = await Lead.findOne({
      "chatHistory.messageId": messageId,
    });

    if (lead) {
      const messageIndex = lead.chatHistory.findIndex(
        (msg) => msg.messageId === messageId
      );

      if (messageIndex !== -1) {
        lead.chatHistory[messageIndex].status = status as
          | "sent"
          | "delivered"
          | "read"
          | "failed";
        await lead.save();
        console.log(`Message status updated: ${messageId} -> ${status}`);
      }
    }
  } catch (error) {
    console.error("Error updating message status:", error);
    throw error;
  }
};

// Note: The extractPersonData function is provided externally
// and uses Gemini model for natural language processing

import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import DynamicTextArea from "react-textarea-autosize"

import { mentionRegex, mentionRegexGlobal, unescapeSpaces } from "@roo/context-mentions"
import { WebviewMessage } from "@roo/WebviewMessage"
import { Mode, getAllModes } from "@roo/modes"
import { ExtensionMessage } from "@roo/ExtensionMessage"

import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	ContextMenuOptionType,
	getContextMenuOptions,
	insertMention,
	removeMention,
	shouldShowContextMenu,
	SearchResult,
} from "@src/utils/context-mentions"
import { convertToMentionPath } from "@/utils/path-mentions"
import { SelectDropdown, DropdownOptionType, Button } from "@/components/ui"
// import { normalizeApiConfiguration } from "@/utils/normalizeApiConfiguration" // kilocode_change
import { useVSCodeTheme } from "@/kilocode/hooks/useVSCodeTheme" // kilocode_change

import Thumbnails from "../common/Thumbnails"
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView"
import ContextMenu from "./ContextMenu"
import { VolumeX, Pin, Check } from "lucide-react"
import { IconButton } from "./IconButton"
import { IndexingStatusDot } from "./IndexingStatusBadge"
import { cn } from "@/lib/utils"
import { usePromptHistory } from "./hooks/usePromptHistory"

import { useSelectedModel } from "../ui/hooks/useSelectedModel"

// kilocode_change start: pull slash commands from Cline
import SlashCommandMenu from "@/components/chat/SlashCommandMenu"
import {
	SlashCommand,
	shouldShowSlashCommandsMenu,
	getMatchingSlashCommands,
	insertSlashCommand,
	validateSlashCommand,
} from "@/utils/slash-commands"
// kilocode_change end

interface ChatTextAreaProps {
	inputValue: string
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	selectApiConfigDisabled: boolean
	placeholderText: string
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	onSend: () => void
	onSelectImages: () => void
	shouldDisableImages: boolean
	onHeightChange?: (height: number) => void
	mode: Mode
	setMode: (value: Mode) => void
	modeShortcutText: string
}

const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			sendingDisabled,
			selectApiConfigDisabled,
			placeholderText,
			selectedImages,
			setSelectedImages,
			onSend,
			onSelectImages,
			shouldDisableImages,
			onHeightChange,
			mode,
			setMode,
			modeShortcutText,
		},
		ref,
	) => {
		const { t } = useAppTranslation()
		const {
			filePaths,
			openedTabs,
			currentApiConfigName,
			listApiConfigMeta,
			customModes,
			cwd,
			pinnedApiConfigs,
			togglePinnedApiConfig,
			apiConfiguration, // kilocode_change
			localWorkflows, // kilocode_change
			globalWorkflows, // kilocode_change
			taskHistory,
			clineMessages,
			codebaseIndexConfig,
		} = useExtensionState()

		const currentTheme = useVSCodeTheme() // kilocode_change

		// Find the ID and display text for the currently selected API configuration
		const { currentConfigId, displayName } = useMemo(() => {
			const currentConfig = listApiConfigMeta?.find((config) => config.name === currentApiConfigName)
			return {
				currentConfigId: currentConfig?.id || "",
				displayName: currentApiConfigName || "", // Use the name directly for display
			}
		}, [listApiConfigMeta, currentApiConfigName])

		// kilocode_change start
		const { id: selectedModelId, provider: selectedProvider } = useSelectedModel(apiConfiguration)
		// kilocode_change end

		const [gitCommits, setGitCommits] = useState<any[]>([])
		const [showDropdown, setShowDropdown] = useState(false)
		const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])

		// kilocode_change begin: remove button from chat when it gets to small
		const [containerWidth, setContainerWidth] = useState<number>(300) // Default to a value larger than our threshold

		const containerRef = useRef<HTMLDivElement>(null)
		const actionButtonsRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			if (!containerRef.current) return

			// Check if ResizeObserver is available (it won't be in test environment)
			if (typeof ResizeObserver === "undefined") return

			const resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					const width = entry.contentRect.width
					setContainerWidth(width)
				}
			})

			resizeObserver.observe(containerRef.current)

			return () => {
				resizeObserver.disconnect()
			}
		}, [])
		// kilocode_change end

		const [searchLoading, setSearchLoading] = useState(false)
		const [searchRequestId, setSearchRequestId] = useState<string>("")

		// Close dropdown when clicking outside.
		useEffect(() => {
			const handleClickOutside = () => {
				if (showDropdown) {
					setShowDropdown(false)
				}
			}

			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}, [showDropdown])

		// Handle enhanced prompt response and search results.
		useEffect(() => {
			const messageHandler = (event: MessageEvent) => {
				const message = event.data

				if (message.type === "enhancedPrompt") {
					if (message.text) {
						setInputValue(message.text)
					}

					setIsEnhancingPrompt(false)
				} else if (message.type === "commitSearchResults") {
					const commits = message.commits.map((commit: any) => ({
						type: ContextMenuOptionType.Git,
						value: commit.hash,
						label: commit.subject,
						description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
						icon: "$(git-commit)",
					}))

					setGitCommits(commits)
				} else if (message.type === "fileSearchResults") {
					setSearchLoading(false)
					if (message.requestId === searchRequestId) {
						setFileSearchResults(message.results || [])
					}
				}
			}

			window.addEventListener("message", messageHandler)
			return () => window.removeEventListener("message", messageHandler)
		}, [setInputValue, searchRequestId])

		const [isDraggingOver, setIsDraggingOver] = useState(false)
		// kilocode_change start: pull slash commands from Cline
		const [showSlashCommandsMenu, setShowSlashCommandsMenu] = useState(false)
		const [selectedSlashCommandsIndex, setSelectedSlashCommandsIndex] = useState(0)
		const [slashCommandsQuery, setSlashCommandsQuery] = useState("")
		const slashCommandsMenuContainerRef = useRef<HTMLDivElement>(null)
		// kilocode_end
		const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<number | undefined>(undefined)
		const [showContextMenu, setShowContextMenu] = useState(false)
		const [cursorPosition, setCursorPosition] = useState(0)
		const [searchQuery, setSearchQuery] = useState("")
		const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
		const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false)
		const highlightLayerRef = useRef<HTMLDivElement>(null)
		const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1)
		const [selectedType, setSelectedType] = useState<ContextMenuOptionType | null>(null)
		const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
		const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
		const contextMenuContainerRef = useRef<HTMLDivElement>(null)
		const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false)
		const [isFocused, setIsFocused] = useState(false)

		// Use custom hook for prompt history navigation
		const { handleHistoryNavigation, resetHistoryNavigation, resetOnInputChange } = usePromptHistory({
			clineMessages,
			taskHistory,
			cwd,
			inputValue,
			setInputValue,
		})

		// Fetch git commits when Git is selected or when typing a hash.
		useEffect(() => {
			if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
				const message: WebviewMessage = {
					type: "searchCommits",
					query: searchQuery || "",
				} as const
				vscode.postMessage(message)
			}
		}, [selectedType, searchQuery])

		const handleEnhancePrompt = useCallback(() => {
			if (sendingDisabled) {
				return
			}

			const trimmedInput = inputValue.trim()

			if (trimmedInput) {
				setIsEnhancingPrompt(true)
				vscode.postMessage({ type: "enhancePrompt" as const, text: trimmedInput })
			} else {
				setInputValue(t("chat:enhancePromptDescription"))
			}
		}, [inputValue, sendingDisabled, setInputValue, t])

		const queryItems = useMemo(() => {
			return [
				{ type: ContextMenuOptionType.Problems, value: "problems" },
				{ type: ContextMenuOptionType.Terminal, value: "terminal" },
				...gitCommits,
				...openedTabs
					.filter((tab) => tab.path)
					.map((tab) => ({
						type: ContextMenuOptionType.OpenedFile,
						value: "/" + tab.path,
					})),
				...filePaths
					.map((file) => "/" + file)
					.filter((path) => !openedTabs.some((tab) => tab.path && "/" + tab.path === path)) // Filter out paths that are already in openedTabs
					.map((path) => ({
						type: path.endsWith("/") ? ContextMenuOptionType.Folder : ContextMenuOptionType.File,
						value: path,
					})),
			]
		}, [filePaths, gitCommits, openedTabs])

		useEffect(() => {
			const handleClickOutside = (event: MouseEvent) => {
				if (
					contextMenuContainerRef.current &&
					!contextMenuContainerRef.current.contains(event.target as Node)
				) {
					setShowContextMenu(false)
				}
			}

			if (showContextMenu) {
				document.addEventListener("mousedown", handleClickOutside)
			}

			return () => {
				document.removeEventListener("mousedown", handleClickOutside)
			}
		}, [showContextMenu, setShowContextMenu])

		const handleMentionSelect = useCallback(
			(type: ContextMenuOptionType, value?: string) => {
				// kilocode_change start
				if (type === ContextMenuOptionType.Image) {
					// Close the context menu and remove the @character in this case
					setShowContextMenu(false)
					setSelectedType(null)

					if (textAreaRef.current) {
						const beforeCursor = textAreaRef.current.value.slice(0, cursorPosition)
						const afterCursor = textAreaRef.current.value.slice(cursorPosition)
						const lastAtIndex = beforeCursor.lastIndexOf("@")

						if (lastAtIndex !== -1) {
							const newValue = beforeCursor.slice(0, lastAtIndex) + afterCursor
							setInputValue(newValue)
						}
					}

					// Call the image selection function
					onSelectImages()
					return
				}
				// kilocode_change end

				if (type === ContextMenuOptionType.NoResults) {
					return
				}

				if (type === ContextMenuOptionType.Mode && value) {
					// Handle mode selection.
					setMode(value)
					setInputValue("")
					setShowContextMenu(false)
					vscode.postMessage({ type: "mode", text: value })
					return
				}

				if (
					type === ContextMenuOptionType.File ||
					type === ContextMenuOptionType.Folder ||
					type === ContextMenuOptionType.Git
				) {
					if (!value) {
						setSelectedType(type)
						setSearchQuery("")
						setSelectedMenuIndex(0)
						return
					}
				}

				setShowContextMenu(false)
				setSelectedType(null)

				if (textAreaRef.current) {
					let insertValue = value || ""

					if (type === ContextMenuOptionType.URL) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.Problems) {
						insertValue = "problems"
					} else if (type === ContextMenuOptionType.Terminal) {
						insertValue = "terminal"
					} else if (type === ContextMenuOptionType.Git) {
						insertValue = value || ""
					}

					const { newValue, mentionIndex } = insertMention(
						textAreaRef.current.value,
						cursorPosition,
						insertValue,
					)

					setInputValue(newValue)
					const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)

					// Scroll to cursor.
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[setInputValue, cursorPosition],
		)

		// kilocode_change start: pull slash commands from Cline
		const handleSlashCommandsSelect = useCallback(
			(command: SlashCommand) => {
				setShowSlashCommandsMenu(false)

				// Handle mode switching commands
				const modeSwitchCommands = getAllModes(customModes).map((mode) => mode.slug)
				if (modeSwitchCommands.includes(command.name)) {
					// Switch to the selected mode
					setMode(command.name as Mode)
					setInputValue("")
					vscode.postMessage({ type: "mode", text: command.name })
					return
				}

				// Handle other slash commands (like newtask)
				if (textAreaRef.current) {
					const { newValue, commandIndex } = insertSlashCommand(textAreaRef.current.value, command.name)
					const newCursorPosition = newValue.indexOf(" ", commandIndex + 1 + command.name.length) + 1

					setInputValue(newValue)
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)

					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			[setInputValue, setMode, customModes],
		)
		// kilocode_change end

		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				// kilocode_change start: pull slash commands from Cline
				if (showSlashCommandsMenu) {
					if (event.key === "Escape") {
						setShowSlashCommandsMenu(false)
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedSlashCommandsIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							const commands = getMatchingSlashCommands(
								slashCommandsQuery,
								customModes,
								localWorkflows,
								globalWorkflows,
							) // kilocode_change

							if (commands.length === 0) {
								return prevIndex
							}

							const newIndex = (prevIndex + direction + commands.length) % commands.length
							return newIndex
						})
						return
					}

					if ((event.key === "Enter" || event.key === "Tab") && selectedSlashCommandsIndex !== -1) {
						event.preventDefault()
						const commands = getMatchingSlashCommands(
							slashCommandsQuery,
							customModes,
							localWorkflows,
							globalWorkflows,
						) // kilocode_change
						if (commands.length > 0) {
							handleSlashCommandsSelect(commands[selectedSlashCommandsIndex])
						}
						return
					}
				}
				// kilocode_change end
				if (showContextMenu) {
					if (event.key === "Escape") {
						setSelectedType(null)
						setSelectedMenuIndex(3) // File by default
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedMenuIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							const options = getContextMenuOptions(
								searchQuery,
								inputValue,
								selectedType,
								queryItems,
								fileSearchResults,
								getAllModes(customModes),
							)
							const optionsLength = options.length

							if (optionsLength === 0) return prevIndex

							// Find selectable options (non-URL types)
							const selectableOptions = options.filter(
								(option) =>
									option.type !== ContextMenuOptionType.URL &&
									option.type !== ContextMenuOptionType.NoResults,
							)

							if (selectableOptions.length === 0) return -1 // No selectable options

							// Find the index of the next selectable option
							const currentSelectableIndex = selectableOptions.findIndex(
								(option) => option === options[prevIndex],
							)

							const newSelectableIndex =
								(currentSelectableIndex + direction + selectableOptions.length) %
								selectableOptions.length

							// Find the index of the selected option in the original options array
							return options.findIndex((option) => option === selectableOptions[newSelectableIndex])
						})
						return
					}
					if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
						event.preventDefault()
						const selectedOption = getContextMenuOptions(
							searchQuery,
							inputValue,
							selectedType,
							queryItems,
							fileSearchResults,
							getAllModes(customModes),
						)[selectedMenuIndex]
						if (
							selectedOption &&
							selectedOption.type !== ContextMenuOptionType.URL &&
							selectedOption.type !== ContextMenuOptionType.NoResults
						) {
							handleMentionSelect(selectedOption.type, selectedOption.value)
						}
						return
					}
				}

				const isComposing = event.nativeEvent?.isComposing ?? false

				// Handle prompt history navigation using custom hook
				if (handleHistoryNavigation(event, showContextMenu, isComposing)) {
					return
				}

				if (event.key === "Enter" && !event.shiftKey && !isComposing) {
					event.preventDefault()

					if (!sendingDisabled) {
						// Reset history navigation state when sending
						resetHistoryNavigation()
						onSend()
					}
				}

				if (event.key === "Backspace" && !isComposing) {
					const charBeforeCursor = inputValue[cursorPosition - 1]
					const charAfterCursor = inputValue[cursorPosition + 1]

					const charBeforeIsWhitespace =
						charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"

					const charAfterIsWhitespace =
						charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"

					// Checks if char before cusor is whitespace after a mention.
					if (
						charBeforeIsWhitespace &&
						// "$" is added to ensure the match occurs at the end of the string.
						inputValue.slice(0, cursorPosition - 1).match(new RegExp(mentionRegex.source + "$"))
					) {
						const newCursorPosition = cursorPosition - 1
						// If mention is followed by another word, then instead
						// of deleting the space separating them we just move
						// the cursor to the end of the mention.
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}

						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterMention(true)
					} else if (justDeletedSpaceAfterMention) {
						const { newText, newPosition } = removeMention(inputValue, cursorPosition)

						if (newText !== inputValue) {
							event.preventDefault()
							setInputValue(newText)
							setIntendedCursorPosition(newPosition) // Store the new cursor position in state
						}

						setJustDeletedSpaceAfterMention(false)
						setShowContextMenu(false)
					} else {
						setJustDeletedSpaceAfterMention(false)
					}
				}
			},
			[
				showSlashCommandsMenu, // kilocode_change
				sendingDisabled,
				showContextMenu,
				selectedSlashCommandsIndex,
				slashCommandsQuery,
				handleSlashCommandsSelect,
				selectedMenuIndex,
				searchQuery,
				inputValue,
				selectedType,
				queryItems,
				fileSearchResults,
				handleHistoryNavigation,
				resetHistoryNavigation,
				cursorPosition,
				customModes,
				handleMentionSelect,
				justDeletedSpaceAfterMention,
				onSend,
				setInputValue,
				localWorkflows, // kilocode_change
				globalWorkflows, // kilocode_change
			],
		)

		useLayoutEffect(() => {
			if (intendedCursorPosition !== null && textAreaRef.current) {
				textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
				setIntendedCursorPosition(null) // Reset the state.
			}
		}, [inputValue, intendedCursorPosition])

		// Ref to store the search timeout.
		const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

		const handleInputChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				const newValue = e.target.value
				setInputValue(newValue)

				// Reset history navigation when user types
				resetOnInputChange()

				const newCursorPosition = e.target.selectionStart
				setInputValue(newValue)
				setCursorPosition(newCursorPosition)
				// kilocode_change start: pull slash commands from Cline
				let showMenu = shouldShowContextMenu(newValue, newCursorPosition)
				const showSlashCommandsMenu = shouldShowSlashCommandsMenu(newValue, newCursorPosition)

				// we do not allow both menus to be shown at the same time
				// the slash commands menu has precedence bc its a narrower component
				if (showSlashCommandsMenu) {
					showMenu = false
				}

				setShowSlashCommandsMenu(showSlashCommandsMenu)
				// kilocode_change end

				setShowContextMenu(showMenu)

				// kilocode_change start: pull slash commands from Cline
				if (showSlashCommandsMenu) {
					const slashIndex = newValue.indexOf("/")
					const query = newValue.slice(slashIndex + 1, newCursorPosition)
					setSlashCommandsQuery(query)
					setSelectedSlashCommandsIndex(0)
				} else {
					setSlashCommandsQuery("")
					setSelectedSlashCommandsIndex(0)
				}
				// kilocode_change end

				if (showMenu) {
					if (newValue.startsWith("/")) {
						// Handle slash command.
						const query = newValue
						setSearchQuery(query)
						setSelectedMenuIndex(0)
					} else {
						// Existing @ mention handling.
						const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
						const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
						setSearchQuery(query)

						// Send file search request if query is not empty.
						if (query.length > 0) {
							setSelectedMenuIndex(0)

							// Don't clear results until we have new ones. This
							// prevents flickering.

							// Clear any existing timeout.
							if (searchTimeoutRef.current) {
								clearTimeout(searchTimeoutRef.current)
							}

							// Set a timeout to debounce the search requests.
							searchTimeoutRef.current = setTimeout(() => {
								// Generate a request ID for this search.
								const reqId = Math.random().toString(36).substring(2, 9)
								setSearchRequestId(reqId)
								setSearchLoading(true)

								// Send message to extension to search files.
								vscode.postMessage({
									type: "searchFiles",
									query: unescapeSpaces(query),
									requestId: reqId,
								})
							}, 200) // 200ms debounce.
						} else {
							setSelectedMenuIndex(3) // Set to "File" option by default.
						}
					}
				} else {
					setSearchQuery("")
					setSelectedMenuIndex(-1)
					setFileSearchResults([]) // Clear file search results.
				}
			},
			[setInputValue, setSearchRequestId, setFileSearchResults, setSearchLoading, resetOnInputChange],
		)

		useEffect(() => {
			if (!showContextMenu) {
				setSelectedType(null)
			}
		}, [showContextMenu])

		const handleBlur = useCallback(() => {
			// Only hide the context menu if the user didn't click on it.
			if (!isMouseDownOnMenu) {
				setShowContextMenu(false)
				setShowSlashCommandsMenu(false) // kilocode_change: pull slash commands from Cline
			}

			setIsFocused(false)
		}, [isMouseDownOnMenu])

		const handlePaste = useCallback(
			async (e: React.ClipboardEvent) => {
				const items = e.clipboardData.items

				const pastedText = e.clipboardData.getData("text")
				// Check if the pasted content is a URL, add space after so user
				// can easily delete if they don't want it.
				const urlRegex = /^\S+:\/\/\S+$/
				if (urlRegex.test(pastedText.trim())) {
					e.preventDefault()
					const trimmedUrl = pastedText.trim()
					const newValue =
						inputValue.slice(0, cursorPosition) + trimmedUrl + " " + inputValue.slice(cursorPosition)
					setInputValue(newValue)
					const newCursorPosition = cursorPosition + trimmedUrl.length + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					setShowContextMenu(false)

					// Scroll to new cursor position.
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)

					return
				}

				const acceptedTypes = ["png", "jpeg", "webp"]

				const imageItems = Array.from(items).filter((item) => {
					const [type, subtype] = item.type.split("/")
					return type === "image" && acceptedTypes.includes(subtype)
				})

				if (!shouldDisableImages && imageItems.length > 0) {
					e.preventDefault()

					const imagePromises = imageItems.map((item) => {
						return new Promise<string | null>((resolve) => {
							const blob = item.getAsFile()

							if (!blob) {
								resolve(null)
								return
							}

							const reader = new FileReader()

							reader.onloadend = () => {
								if (reader.error) {
									console.error(t("chat:errorReadingFile"), reader.error)
									resolve(null)
								} else {
									const result = reader.result
									resolve(typeof result === "string" ? result : null)
								}
							}

							reader.readAsDataURL(blob)
						})
					})

					const imageDataArray = await Promise.all(imagePromises)
					const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

					if (dataUrls.length > 0) {
						setSelectedImages((prevImages) => [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE))
					} else {
						console.warn(t("chat:noValidImages"))
					}
				}
			},
			[shouldDisableImages, setSelectedImages, cursorPosition, setInputValue, inputValue, t],
		)

		const handleMenuMouseDown = useCallback(() => {
			setIsMouseDownOnMenu(true)
		}, [])

		const updateHighlights = useCallback(() => {
			if (!textAreaRef.current || !highlightLayerRef.current) return

			// kilocode_change start: pull slash commands from Cline
			let processedText = textAreaRef.current.value

			processedText = processedText
				.replace(/\n$/, "\n\n")
				.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)
				.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>')

			// check for highlighting /slash-commands
			if (/^\s*\//.test(processedText)) {
				const slashIndex = processedText.indexOf("/")

				// end of command is end of text or first whitespace
				const spaceIndex = processedText.indexOf(" ", slashIndex)
				const endIndex = spaceIndex > -1 ? spaceIndex : processedText.length

				// extract and validate the exact command text
				const commandText = processedText.substring(slashIndex + 1, endIndex)
				const isValidCommand = validateSlashCommand(commandText, customModes)

				if (isValidCommand) {
					const fullCommand = processedText.substring(slashIndex, endIndex) // includes slash

					const highlighted = `<mark class="slash-command-match-textarea-highlight">${fullCommand}</mark>`
					processedText =
						processedText.substring(0, slashIndex) + highlighted + processedText.substring(endIndex)
				}
			}
			// kilocode_change end

			highlightLayerRef.current.innerHTML = processedText
			highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
			highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
		}, [customModes])

		useLayoutEffect(() => {
			updateHighlights()
		}, [inputValue, updateHighlights])

		const updateCursorPosition = useCallback(() => {
			if (textAreaRef.current) {
				setCursorPosition(textAreaRef.current.selectionStart)
			}
		}, [])

		const handleKeyUp = useCallback(
			(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
					updateCursorPosition()
				}
			},
			[updateCursorPosition],
		)

		const handleDrop = useCallback(
			async (e: React.DragEvent<HTMLDivElement>) => {
				e.preventDefault()
				setIsDraggingOver(false)

				const textFieldList = e.dataTransfer.getData("text")
				const textUriList = e.dataTransfer.getData("application/vnd.code.uri-list")
				// When textFieldList is empty, it may attempt to use textUriList obtained from drag-and-drop tabs; if not empty, it will use textFieldList.
				const text = textFieldList || textUriList
				if (text) {
					// Split text on newlines to handle multiple files
					const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")

					if (lines.length > 0) {
						// Process each line as a separate file path
						let newValue = inputValue.slice(0, cursorPosition)
						let totalLength = 0

						// Using a standard for loop instead of forEach for potential performance gains.
						for (let i = 0; i < lines.length; i++) {
							const line = lines[i]
							// Convert each path to a mention-friendly format
							const mentionText = convertToMentionPath(line, cwd)
							newValue += mentionText
							totalLength += mentionText.length

							// Add space after each mention except the last one
							if (i < lines.length - 1) {
								newValue += " "
								totalLength += 1
							}
						}

						// Add space after the last mention and append the rest of the input
						newValue += " " + inputValue.slice(cursorPosition)
						totalLength += 1

						setInputValue(newValue)
						const newCursorPosition = cursorPosition + totalLength
						setCursorPosition(newCursorPosition)
						setIntendedCursorPosition(newCursorPosition)
					}

					return
				}

				const files = Array.from(e.dataTransfer.files)

				if (files.length > 0) {
					const acceptedTypes = ["png", "jpeg", "webp"]

					const imageFiles = files.filter((file) => {
						const [type, subtype] = file.type.split("/")
						return type === "image" && acceptedTypes.includes(subtype)
					})

					if (!shouldDisableImages && imageFiles.length > 0) {
						const imagePromises = imageFiles.map((file) => {
							return new Promise<string | null>((resolve) => {
								const reader = new FileReader()

								reader.onloadend = () => {
									if (reader.error) {
										console.error(t("chat:errorReadingFile"), reader.error)
										resolve(null)
									} else {
										const result = reader.result
										resolve(typeof result === "string" ? result : null)
									}
								}

								reader.readAsDataURL(file)
							})
						})

						const imageDataArray = await Promise.all(imagePromises)
						const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

						if (dataUrls.length > 0) {
							setSelectedImages((prevImages) =>
								[...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE),
							)

							if (typeof vscode !== "undefined") {
								vscode.postMessage({ type: "draggedImages", dataUrls: dataUrls })
							}
						} else {
							console.warn(t("chat:noValidImages"))
						}
					}
				}
			},
			[
				cursorPosition,
				cwd,
				inputValue,
				setInputValue,
				setCursorPosition,
				setIntendedCursorPosition,
				shouldDisableImages,
				setSelectedImages,
				t,
			],
		)

		const [isTtsPlaying, setIsTtsPlaying] = useState(false)

		useEvent("message", (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "ttsStart") {
				setIsTtsPlaying(true)
			} else if (message.type === "ttsStop") {
				setIsTtsPlaying(false)
			}
		})

		const placeholderBottomText = `\n(${t("chat:addContext")}${shouldDisableImages ? `, ${t("chat:dragFiles")}` : `, ${t("chat:dragFilesImages")}`})`

		return (
			<div
				className={cn(
					"relative",
					"flex",
					"flex-col",
					"gap-2",
					"bg-editor-background",
					"m-2 mt-1",
					"p-1.5",
					"outline-none",
					"border",
					"border-none",
					"w-[calc(100%-16px)]",
					"ml-auto",
					"mr-auto",
					"box-border",
				)}>
				<div className="relative">
					<div
						className={cn("chat-text-area", "relative", "flex", "flex-col", "outline-none")}
						onDrop={handleDrop}
						onDragOver={(e) => {
							// Only allowed to drop images/files on shift key pressed.
							if (!e.shiftKey) {
								setIsDraggingOver(false)
								return
							}

							e.preventDefault()
							setIsDraggingOver(true)
							e.dataTransfer.dropEffect = "copy"
						}}
						onDragLeave={(e) => {
							e.preventDefault()
							const rect = e.currentTarget.getBoundingClientRect()

							if (
								e.clientX <= rect.left ||
								e.clientX >= rect.right ||
								e.clientY <= rect.top ||
								e.clientY >= rect.bottom
							) {
								setIsDraggingOver(false)
							}
						}}>
						{/* kilocode_change start: pull slash commands from Cline */}
						{showSlashCommandsMenu && (
							<div ref={slashCommandsMenuContainerRef}>
								<SlashCommandMenu
									onSelect={handleSlashCommandsSelect}
									selectedIndex={selectedSlashCommandsIndex}
									setSelectedIndex={setSelectedSlashCommandsIndex}
									onMouseDown={handleMenuMouseDown}
									query={slashCommandsQuery}
									customModes={customModes}
								/>
							</div>
						)}
						{/* kilocode_change end */}
						{showContextMenu && (
							<div
								ref={contextMenuContainerRef}
								className={cn(
									"absolute",
									"bottom-full",
									"left-0",
									"right-0",
									"z-[1000]",
									"mb-2",
									"filter",
									"drop-shadow-md",
								)}>
								<ContextMenu
									onSelect={handleMentionSelect}
									searchQuery={searchQuery}
									inputValue={inputValue}
									onMouseDown={handleMenuMouseDown}
									selectedIndex={selectedMenuIndex}
									setSelectedIndex={setSelectedMenuIndex}
									selectedType={selectedType}
									queryItems={queryItems}
									modes={getAllModes(customModes)}
									loading={searchLoading}
									dynamicSearchResults={fileSearchResults}
								/>
							</div>
						)}
						<div
							className={cn(
								"relative",
								"flex-1",
								"flex",
								"flex-col-reverse",
								"min-h-0",
								"overflow-hidden",
								"rounded",
							)}>
							<div
								ref={highlightLayerRef}
								className={cn(
									"absolute",
									"inset-0",
									"pointer-events-none",
									"whitespace-pre-wrap",
									"break-words",
									"text-transparent",
									"overflow-hidden",
									"font-vscode-font-family",
									"text-vscode-editor-font-size",
									"leading-vscode-editor-line-height",
									"py-2",
									"px-[9px]",
									"z-10",
									"forced-color-adjust-none",
								)}
								style={{
									color: "transparent",
								}}
							/>
							<DynamicTextArea
								ref={(el) => {
									if (typeof ref === "function") {
										ref(el)
									} else if (ref) {
										ref.current = el
									}
									textAreaRef.current = el
								}}
								value={inputValue}
								onChange={(e) => {
									handleInputChange(e)
									updateHighlights()
								}}
								onFocus={() => setIsFocused(true)}
								onKeyDown={handleKeyDown}
								onKeyUp={handleKeyUp}
								onBlur={handleBlur}
								onPaste={handlePaste}
								onSelect={updateCursorPosition}
								onMouseUp={updateCursorPosition}
								onHeightChange={(height) => {
									if (textAreaBaseHeight === undefined || height < textAreaBaseHeight) {
										setTextAreaBaseHeight(height)
									}

									onHeightChange?.(height)
								}}
								// kilocode_change: combine placeholderText and placeholderBottomText here
								placeholder={`${placeholderText}\n${placeholderBottomText}`}
								minRows={3}
								maxRows={15}
								autoFocus={true}
								className={cn(
									"w-full",
									"text-vscode-input-foreground",
									"font-vscode-font-family",
									"text-vscode-editor-font-size",
									"leading-vscode-editor-line-height",
									"cursor-text",
									"py-1.5 px-2",
									isFocused
										? "border border-vscode-focusBorder outline outline-vscode-focusBorder"
										: isDraggingOver
											? "border-2 border-dashed border-vscode-focusBorder"
											: "border border-transparent",
									isDraggingOver
										? "bg-[color-mix(in_srgb,var(--vscode-input-background)_95%,var(--vscode-focusBorder))]"
										: "bg-vscode-input-background",
									"transition-background-color duration-150 ease-in-out",
									"will-change-background-color",
									"min-h-[90px]",
									"box-border",
									"rounded",
									"resize-none",
									"overflow-x-hidden",
									"overflow-y-auto",
									"pr-2",
									"flex-none flex-grow",
									"z-[2]",
									"scrollbar-none",
									"pb-16", // Increased padding to prevent overlap with control bar
									"scroll-pb-16", // Increased padding to prevent overlap with control bar
								)}
								onScroll={() => updateHighlights()}
							/>
							{/* kilocode_change {Transparent overlay at bottom of textArea to avoid text overlap } */}
							<div
								className="absolute bottom-[1px] left-2 right-2 h-16 bg-gradient-to-t from-[var(--vscode-input-background)] via-[var(--vscode-input-background)] to-transparent pointer-events-none z-[2]"
								aria-hidden="true"
							/>

							{isTtsPlaying && (
								<Button
									variant="ghost"
									size="icon"
									className="absolute top-0 right-0 opacity-25 hover:opacity-100 z-10"
									onClick={() => vscode.postMessage({ type: "stopTts" })}>
									<VolumeX className="size-4" />
								</Button>
							)}

							{!inputValue && (
								<div
									className={cn(
										"absolute",
										"left-2",
										"flex",
										"gap-2",
										"text-xs",
										"text-descriptionForeground",
										"pointer-events-none",
										"z-25",
										"bottom-1.5",
										"pr-2",
										"transition-opacity",
										"duration-200",
										"ease-in-out",
										"opacity-70",
									)}>
									{/* kilocode_change {placeholderBottomText} */}
								</div>
							)}
						</div>
					</div>
				</div>

				{/* kilocode_change move thumbnails to bottom */}

				<div
					// kilocode_change start
					style={{
						marginTop: "-44px",
						zIndex: 2,
						paddingLeft: "10px",
						paddingRight: "10px",
					}}
					ref={containerRef}
					// kilocode_change end
					className={cn("flex", "justify-between", "items-center", "mt-auto", "pt-0.5")}>
					<div className={cn("flex", "items-center", "gap-1", "min-w-0")}>
						<div className="shrink-0">
							<SelectDropdown
								value={mode}
								title={t("chat:selectMode")}
								options={[
									{
										value: "shortcut",
										label: modeShortcutText,
										disabled: true,
										type: DropdownOptionType.SHORTCUT,
									},
									...getAllModes(customModes).map((mode) => ({
										value: mode.slug,
										label: mode.name,
										codicon: mode.iconName, // kilocode_change
										type: DropdownOptionType.ITEM,
									})),
									{
										value: "sep-1",
										label: t("chat:separator"),
										type: DropdownOptionType.SEPARATOR,
									},
									{
										value: "promptsButtonClicked",
										label: t("chat:edit"),
										type: DropdownOptionType.ACTION,
									},
								]}
								onChange={(value) => {
									setMode(value as Mode)
									vscode.postMessage({ type: "mode", text: value })
								}}
								shortcutText={modeShortcutText}
								triggerClassName={cn("w-full", {
									"bg-[#1e1e1e] border-[#333333] hover:bg-[#2d2d2d]":
										currentTheme === "vscode-dark" || currentTheme === "vscode-high-contrast",
									"bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] hover:bg-[var(--vscode-input-hoverBackground)]":
										currentTheme === "vscode-light",
								})}
							/>
						</div>

						{/* kilocode_change: fixed width */}
						{/* API configuration selector - fixed width */}
						<div className={cn("shrink-0", "w-[70px]")}>
							<SelectDropdown
								value={currentConfigId}
								disabled={selectApiConfigDisabled}
								title={t("chat:selectApiConfig")}
								placeholder={displayName}
								options={[
									// Pinned items first.
									...(listApiConfigMeta || [])
										.filter((config) => pinnedApiConfigs && pinnedApiConfigs[config.id])
										.map((config) => ({
											value: config.id,
											label: config.name,
											name: config.name, // Keep name for comparison with currentApiConfigName.
											type: DropdownOptionType.ITEM,
											pinned: true,
										}))
										.sort((a, b) => a.label.localeCompare(b.label)),
									// If we have pinned items and unpinned items, add a separator.
									...(pinnedApiConfigs &&
									Object.keys(pinnedApiConfigs).length > 0 &&
									(listApiConfigMeta || []).some((config) => !pinnedApiConfigs[config.id])
										? [
												{
													value: "sep-pinned",
													label: t("chat:separator"),
													type: DropdownOptionType.SEPARATOR,
												},
											]
										: []),
									// Unpinned items sorted alphabetically.
									...(listApiConfigMeta || [])
										.filter((config) => !pinnedApiConfigs || !pinnedApiConfigs[config.id])
										.map((config) => ({
											value: config.id,
											label: config.name,
											name: config.name, // Keep name for comparison with currentApiConfigName.
											type: DropdownOptionType.ITEM,
											pinned: false,
										}))
										.sort((a, b) => a.label.localeCompare(b.label)),
									{
										value: "sep-2",
										label: t("chat:separator"),
										type: DropdownOptionType.SEPARATOR,
									},
									{
										value: "settingsButtonClicked",
										label: t("chat:edit"),
										type: DropdownOptionType.ACTION,
									},
								]}
								onChange={(value) => {
									if (value === "settingsButtonClicked") {
										vscode.postMessage({
											type: "loadApiConfiguration",
											text: value,
											values: { section: "providers" },
										})
									} else {
										vscode.postMessage({ type: "loadApiConfigurationById", text: value })
									}
								}}
								contentClassName="max-h-[300px] overflow-y-auto"
								// kilocode_change: add different border and background colors
								triggerClassName={cn("w-full text-ellipsis overflow-hidden", {
									"bg-[#1e1e1e] border-[#333333] hover:bg-[#2d2d2d]":
										currentTheme === "vscode-dark" || currentTheme === "vscode-high-contrast",
									"bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] hover:bg-[var(--vscode-input-hoverBackground)]":
										currentTheme === "vscode-light",
								})}
								itemClassName="group"
								renderItem={({ type, value, label, pinned }) => {
									if (type !== DropdownOptionType.ITEM) {
										return label
									}

									const config = listApiConfigMeta?.find((c) => c.id === value)
									const isCurrentConfig = config?.name === currentApiConfigName

									return (
										<div className="flex justify-between gap-2 w-full h-5">
											<div
												className={cn("truncate min-w-0 overflow-hidden", {
													"font-medium": isCurrentConfig,
												})}
												title={label}>
												{label}
											</div>
											<div className="flex justify-end w-10 flex-shrink-0">
												<div
													className={cn("size-5 p-1", {
														"block group-hover:hidden": !pinned,
														hidden: !isCurrentConfig,
													})}>
													<Check className="size-3" />
												</div>
												<Button
													variant="ghost"
													size="icon"
													title={pinned ? t("chat:unpin") : t("chat:pin")}
													onClick={(e) => {
														e.stopPropagation()
														togglePinnedApiConfig(value)
														vscode.postMessage({ type: "toggleApiConfigPin", text: value })
													}}
													className={cn("size-5", {
														"hidden group-hover:flex": !pinned,
														"bg-accent": pinned,
													})}>
													<Pin className="size-3 p-0.5 opacity-50" />
												</Button>
											</div>
										</div>
									)
								}}
							/>
						</div>

						{/* kilocode_change begin: Model display */}
						<div
							className="flex items-center mx-2 overflow-hidden"
							title={`${selectedProvider}:${selectedModelId}`}>
							<span className="text-xs text-vscode-descriptionForeground opacity-70 truncate">
								{selectedProvider}:{selectedModelId}
							</span>
						</div>
						{/* kilocode_change end */}
					</div>

					<div
						//  kilocode_change: add ref and add hidden on small containerWidth
						className={cn("flex", "items-center", "gap-0.5", "shrink-0", { hidden: containerWidth < 235 })}
						ref={actionButtonsRef}>
						{codebaseIndexConfig?.codebaseIndexEnabled && <IndexingStatusDot />}
						<IconButton
							iconClass={isEnhancingPrompt ? "codicon-loading" : "codicon-sparkle"}
							title={t("chat:enhancePrompt")}
							disabled={sendingDisabled}
							isLoading={isEnhancingPrompt}
							onClick={handleEnhancePrompt}
						/>
						<IconButton
							iconClass="codicon-attach"
							title="Add Context (@)"
							disabled={showContextMenu}
							onClick={() => {
								if (showContextMenu || !textAreaRef.current) return

								textAreaRef.current.focus()

								setInputValue(`${inputValue} @`)
								setShowContextMenu(true)
								// Empty search query explicitly to show all options
								// and set to "File" option by default
								setSearchQuery("")
								setSelectedMenuIndex(4)
							}}
						/>
						<IconButton
							className="hidden" // kilocode_change
							iconClass="codicon-device-camera"
							title={t("chat:addImages")}
							disabled={shouldDisableImages}
							onClick={onSelectImages}
						/>
						<IconButton
							iconClass="codicon-send"
							title={t("chat:sendMessage")}
							disabled={sendingDisabled}
							onClick={onSend}
						/>
					</div>
				</div>

				{selectedImages.length > 0 && (
					<Thumbnails
						images={selectedImages}
						setImages={setSelectedImages}
						style={{
							left: "16px",
							zIndex: 2,
							marginTop: "14px", // kilocode_change
							marginBottom: 0,
						}}
					/>
				)}
			</div>
		)
	},
)

export default ChatTextArea

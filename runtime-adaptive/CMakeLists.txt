cmake_minimum_required(VERSION 3.24)

project(WakuShareAdaptiveRuntime LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)

set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_AUTOMOC ON)
string(REPLACE "/EHsc" "" CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS}")
add_compile_definitions(_SILENCE_CXX20_U8PATH_DEPRECATION_WARNING)

find_package(Qt6 6.2.2 EXACT REQUIRED COMPONENTS Core Gui Qml Quick Network)

add_library(CapSync.AdaptiveEventsV4 SHARED src/CapSync.NativeExplorerObserve/session_events.cpp)
target_link_libraries(CapSync.AdaptiveEventsV4 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveEventsV4 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2)
target_compile_options(CapSync.AdaptiveEventsV4 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveRelayV2 SHARED src/CapSync.NativeExplorerObserve/session_relay.cpp)
target_link_libraries(CapSync.AdaptiveRelayV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveRelayV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2)
target_compile_options(CapSync.AdaptiveRelayV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveCatalogV5 SHARED src/CapSync.NativeExplorerObserve/catalog_read_v6.cpp)
target_link_libraries(CapSync.AdaptiveCatalogV5 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveCatalogV5 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MULTI_DRAFT_SNAPSHOT CAPSYNC_IDENTICAL_SOURCE_ROWS CAPSYNC_TITLE_EVENTS CAPSYNC_LIVE_SOURCE_NAMES CAPSYNC_LIVE_DRAFT_SIDECAR CAPSYNC_TIMELINE_LIFETIME_EVENTS CAPSYNC_TIMELINE_HEALTH)
target_compile_options(CapSync.AdaptiveCatalogV5 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveDocumentsV2 SHARED src/CapSync.NativeExplorerObserve/product_document_read.cpp)
target_link_libraries(CapSync.AdaptiveDocumentsV2 PRIVATE Qt6::Core Qt6::Gui user32)
target_compile_definitions(CapSync.AdaptiveDocumentsV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2)
target_compile_options(CapSync.AdaptiveDocumentsV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveImportV2 SHARED src/CapSync.NativeExplorerObserve/target_drop.cpp)
target_link_libraries(CapSync.AdaptiveImportV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveImportV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MEDIA_PATH CAPSYNC_DECODE_PREFLIGHT)
target_compile_options(CapSync.AdaptiveImportV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveFolderV2 SHARED src/CapSync.NativeFolder/folder.cpp)
target_link_libraries(CapSync.AdaptiveFolderV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Quick user32)
target_compile_definitions(CapSync.AdaptiveFolderV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MULTI_DRAFT_SNAPSHOT CAPSYNC_FOLDER_SDK_BASELINE)
target_compile_options(CapSync.AdaptiveFolderV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveTreeV2 SHARED src/CapSync.NativeAdd/add.cpp)
target_link_libraries(CapSync.AdaptiveTreeV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveTreeV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_GENERAL_PHOTO_PATH CAPSYNC_WINDOWS_PATH_CASE CAPSYNC_MEDIA_PATH CAPSYNC_TREE_MOVE CAPSYNC_LINKED_PHOTO_MOVE)
target_compile_options(CapSync.AdaptiveTreeV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveBinV2 SHARED src/CapSync.NativeRootRead/bin_path.cpp)
target_link_libraries(CapSync.AdaptiveBinV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveBinV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_GENERAL_PHOTO_PATH CAPSYNC_MEDIA_PATH CAPSYNC_PRESERVE_BIN_LABELS CAPSYNC_STOCK_BIN_TITLES CAPSYNC_STOCK_RENAME_TRANSACTION CAPSYNC_EXPLICIT_BIN_LABELS CAPSYNC_TYPED_TITLE_MODELS)
target_compile_options(CapSync.AdaptiveBinV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveSourceV4 SHARED src/CapSync.NativeRootRead/source_path_v4.cpp)
target_link_libraries(CapSync.AdaptiveSourceV4 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveSourceV4 PRIVATE CAPSYNC_MULTI_DRAFT_SNAPSHOT WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_GENERAL_PHOTO_PATH CAPSYNC_WINDOWS_PATH_CASE CAPSYNC_MEDIA_PATH CAPSYNC_LOCAL_AUDIO_TYPES CAPSYNC_RETIRED_LOCAL_AUDIO)
target_compile_options(CapSync.AdaptiveSourceV4 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveSaveV3 SHARED src/CapSync.NativeExplorerObserve/store_save.cpp)
target_link_libraries(CapSync.AdaptiveSaveV3 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveSaveV3 PRIVATE CAPSYNC_MULTI_DRAFT_SNAPSHOT WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2)
target_compile_options(CapSync.AdaptiveSaveV3 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveRemoveV3 SHARED src/CapSync.NativeRootRead/remove_unused.cpp)
target_link_libraries(CapSync.AdaptiveRemoveV3 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveRemoveV3 PRIVATE CAPSYNC_MULTI_DRAFT_SNAPSHOT WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MEDIA_PATH)
target_compile_options(CapSync.AdaptiveRemoveV3 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveViewV2 SHARED src/CapSync.NativeExplorerObserve/product_media_view.cpp)
target_link_libraries(CapSync.AdaptiveViewV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Quick user32)
target_compile_definitions(CapSync.AdaptiveViewV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2)
target_compile_options(CapSync.AdaptiveViewV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptivePromoteRootV2 SHARED src/CapSync.NativeExplorerObserve/product_promote_root.cpp)
target_link_libraries(CapSync.AdaptivePromoteRootV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick user32)
target_compile_definitions(CapSync.AdaptivePromoteRootV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MULTI_DRAFT_SNAPSHOT)
target_compile_options(CapSync.AdaptivePromoteRootV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveBatchImportV2 SHARED src/CapSync.NativeExplorerObserve/target_drop.cpp)
target_link_libraries(CapSync.AdaptiveBatchImportV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick user32)
target_compile_definitions(CapSync.AdaptiveBatchImportV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MEDIA_PATH CAPSYNC_DECODE_PREFLIGHT CAPSYNC_PRODUCT_BATCH CAPSYNC_MASS_IMPORT CAPSYNC_MASS_PHYSICAL_ID CAPSYNC_WHOLE_IMPORT)
target_compile_options(CapSync.AdaptiveBatchImportV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveBatchMoveV2 SHARED src/CapSync.NativeExplorerObserve/product_whole_move.cpp)
target_link_libraries(CapSync.AdaptiveBatchMoveV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick user32)
target_compile_definitions(CapSync.AdaptiveBatchMoveV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MULTI_DRAFT_SNAPSHOT CAPSYNC_BATCH_STABLE_POST_LEASE)
target_compile_options(CapSync.AdaptiveBatchMoveV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveFolderBatchV2 SHARED src/CapSync.NativeExplorerObserve/product_folder_batch.cpp)
target_link_libraries(CapSync.AdaptiveFolderBatchV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick user32)
target_compile_definitions(CapSync.AdaptiveFolderBatchV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MULTI_DRAFT_SNAPSHOT)
target_compile_options(CapSync.AdaptiveFolderBatchV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveSavedReadV2 SHARED src/CapSync.NativeExplorerObserve/product_saved_read_v2.cpp)
target_link_libraries(CapSync.AdaptiveSavedReadV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Quick user32)
target_compile_definitions(CapSync.AdaptiveSavedReadV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_TREE_SCOPE_V2 CAPSYNC_MULTI_DRAFT_SNAPSHOT)
target_compile_options(CapSync.AdaptiveSavedReadV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveRootRelinkV2 SHARED src/CapSync.NativeExplorerObserve/product_root_relink_v2.cpp)
target_link_libraries(CapSync.AdaptiveRootRelinkV2 PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick Qt6::Network user32)
target_compile_definitions(CapSync.AdaptiveRootRelinkV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_EXPLORER_RUNTIME CAPSYNC_EXPLORER_RUNTIME_V2 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_SDK_SAVED_DOCUMENTS CAPSYNC_MULTI_DRAFT_SNAPSHOT)
target_compile_options(CapSync.AdaptiveRootRelinkV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptiveSeedCheckV2 SHARED src/Adaptive/probe.cpp)

target_link_libraries(CapSync.AdaptiveSeedCheckV2 PRIVATE Qt6::Core user32)

target_compile_definitions(CapSync.AdaptiveSeedCheckV2 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)

target_compile_options(CapSync.AdaptiveSeedCheckV2 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)


add_library(CapSync.AdaptiveDraftAuditV1 SHARED src/Adaptive/draft_audit.cpp)
target_link_libraries(CapSync.AdaptiveDraftAuditV1 PRIVATE Qt6::Core Qt6::Gui user32)
target_compile_definitions(CapSync.AdaptiveDraftAuditV1 PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_PRODUCT_RUNTIME CAPSYNC_MULTI_DRAFT_SNAPSHOT CAPSYNC_SDK_SAVED_DOCUMENTS)
target_compile_options(CapSync.AdaptiveDraftAuditV1 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_library(CapSync.AdaptivePreflightV3 SHARED src/Adaptive/preflight.cpp)
target_link_libraries(CapSync.AdaptivePreflightV3 PRIVATE Qt6::Core Qt6::Gui user32)
target_compile_definitions(CapSync.AdaptivePreflightV3 PRIVATE CAPSYNC_TREE_SCOPE_V2 WIN32_LEAN_AND_MEAN NOMINMAX CAPSYNC_PRODUCT_GENERATION=8 CAPSYNC_PRODUCT_RUNTIME CAPSYNC_MULTI_DRAFT_SNAPSHOT CAPSYNC_SDK_SAVED_DOCUMENTS)
target_compile_options(CapSync.AdaptivePreflightV3 PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)

add_executable(AdaptiveTimelineObserverTest tests/adaptive_timeline_observer.cpp)
target_link_libraries(AdaptiveTimelineObserverTest PRIVATE Qt6::Core Qt6::Gui Qt6::Qml Qt6::Quick user32)
target_compile_definitions(AdaptiveTimelineObserverTest PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(AdaptiveTimelineObserverTest PRIVATE /W4 /WX /utf-8 /Zc:__cplusplus /EHa /wd4714)
